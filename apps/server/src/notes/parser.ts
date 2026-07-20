import { createHash } from 'node:crypto';
import path from 'node:path';
import matter from 'gray-matter';

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  body: string;
  title: string;
  tags: string[];
  wikilinks: string[];
}

function titleFromBody(body: string): string | null {
  const m = body.match(/^\s*#{1,6}\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function titleFromPath(relPath: string): string {
  return path.basename(relPath).replace(/\.md$/i, '');
}

function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map((t) => t.trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
}

const INLINE_TAG_RE = /(^|\s)#([a-zA-Z][\w\-/]*)/g;
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g;

export function extractInlineTags(body: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  INLINE_TAG_RE.lastIndex = 0;
  while ((m = INLINE_TAG_RE.exec(body))) out.push(m[2]);
  return out;
}

export function extractWikilinks(body: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(body))) out.push(m[1].trim());
  return out;
}

/** Returns ~90 chars of context around the first occurrence of `needle` in `text`. */
export function snippetAround(text: string, needle: string): string {
  const idx = text.indexOf(needle);
  if (idx < 0) return text.slice(0, 90);
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + needle.length + 60);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

export function parseNote(relPath: string, raw: string): ParsedNote {
  const { data, content } = matter(raw);
  const frontmatter = (data ?? {}) as Record<string, unknown>;
  const title = (typeof frontmatter.title === 'string' && frontmatter.title.trim()) || titleFromBody(content) || titleFromPath(relPath);
  const tags = Array.from(new Set([...normalizeTags(frontmatter.tags), ...extractInlineTags(content)]));
  const wikilinks = Array.from(new Set(extractWikilinks(content)));
  return { frontmatter, body: content, title, tags, wikilinks };
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
