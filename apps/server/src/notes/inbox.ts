import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { DateTime } from 'luxon';
import { buildInboxNotePath, sanitizeVoiceNoteTitle } from '@timeblock/shared';
import type { Settings } from '@timeblock/shared';

function yamlString(value: string) {
  return JSON.stringify(String(value).replace(/\u2028|\u2029/g, ' '));
}

function safeMarkdownUrl(value: string) {
  return String(value || '').replace(/[()\\]/g, (char) => `\\${char}`);
}

export function normalizeVaultFolder(value: string, fallback: string): string {
  const cleaned = String(value || fallback)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => part.replace(/[<>:"|?*\u0000-\u001f]/g, '-').trim())
    .filter(Boolean)
    .join('/');
  return cleaned || fallback;
}

export function buildInboxCaptureContent(input: {
  kind: 'quick' | 'web-clip' | 'voice';
  title: string;
  body: string;
  capturedAt: string;
  source?: string | null;
  sourceTitle?: string | null;
  tags?: string[];
  summary?: string | null;
  transcript?: string | null;
  language?: string | null;
}): string {
  const allTags = [...new Set(['inbox', `${input.kind}-capture`, ...(input.tags ?? [])].filter(Boolean))];
  const sourceLine = input.source ? `> Source: [${input.sourceTitle || input.source}](${safeMarkdownUrl(input.source)})` : '';
  const summaryBlock = input.summary?.trim() ? `> AI summary: ${input.summary.trim()}` : '';
  const transcriptBlock = input.transcript?.trim() ? `\n## Transcript\n\n${input.transcript.trim()}\n` : '';
  return [
    '---',
    'type: inbox-capture',
    `capture: ${input.kind}`,
    `capturedAt: ${yamlString(input.capturedAt)}`,
    `processed: false`,
    input.source ? `source: ${yamlString(input.source)}` : null,
    input.sourceTitle ? `sourceTitle: ${yamlString(input.sourceTitle)}` : null,
    input.language ? `language: ${yamlString(input.language)}` : null,
    'tags:',
    ...allTags.map((tag) => `  - ${tag}`),
    '---',
    '',
    `# ${input.title.replace(/^#+\s*/, '').trim() || 'Capture'}`,
    '',
    sourceLine,
    sourceLine ? '' : null,
    summaryBlock,
    summaryBlock ? '' : null,
    input.body.trim(),
    transcriptBlock,
  ]
    .filter((line) => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
    .concat('\n');
}

export function capturePath(settings: Settings, folder: string, title: string, existingIds: Iterable<string>, now: DateTime): string {
  return buildInboxNotePath(normalizeVaultFolder(folder, `${settings.notesInboxFolder}/Quick`), now.toFormat('yyyy-LL-dd-HHmmss'), title, existingIds);
}

export function simpleHtmlToMarkdown(html: string): { title: string; body: string } {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const title =
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(cleaned)?.[1]?.trim() ||
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(cleaned)?.[1]?.replace(/\s+/g, ' ').trim() ||
    'Web capture';
  const article =
    /<article[^>]*>([\s\S]*?)<\/article>/i.exec(cleaned)?.[1] ||
    /<main[^>]*>([\s\S]*?)<\/main>/i.exec(cleaned)?.[1] ||
    /<body[^>]*>([\s\S]*?)<\/body>/i.exec(cleaned)?.[1] ||
    cleaned;
  const body = article
    .replace(/<\/(p|div|section|article|main|h\d|li|blockquote)>/gi, '$&\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 20_000);
  return { title: title || 'Web capture', body: body || 'Saved for later from the web.' };
}

export async function saveNoteAsset(root: string, attachmentsFolder: string, kind: 'image' | 'audio', originalName: string, bytes: Buffer): Promise<string> {
  const now = new Date().toISOString();
  const dateFolder = now.slice(0, 10);
  const fileName = `${randomUUID()}-${sanitizeVoiceNoteTitle(path.parse(originalName).name)}${path.extname(originalName).slice(0, 12) || (kind === 'audio' ? '.wav' : '.png')}`;
  const relPath = `${normalizeVaultFolder(attachmentsFolder, 'Attachments')}/${kind}/${dateFolder}/${fileName}`;
  const absPath = path.join(root, relPath.replace(/\//g, path.sep));
  await fsp.mkdir(path.dirname(absPath), { recursive: true });
  await fsp.writeFile(absPath, bytes);
  return relPath.replace(/\\/g, '/');
}

export function appendInboxTriage(content: string, next: { title: string; tags: string[]; links: string[]; processed: boolean }): string {
  const parsed = matter(content);
  const frontmatter = { ...(parsed.data ?? {}) } as Record<string, unknown>;
  frontmatter.title = next.title.trim();
  frontmatter.processed = next.processed;
  const mergedTags = [...new Set([...(Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : []), ...next.tags.filter(Boolean)])];
  if (mergedTags.length) frontmatter.tags = mergedTags;

  let body = parsed.content.trimEnd();
  const missingLinks = next.links.filter((link) => !body.includes(`[[${link}]]`));
  if (missingLinks.length) {
    body += `\n\n## Related\n\n${missingLinks.map((link) => `- [[${link}]]`).join('\n')}`;
  }
  return matter.stringify(body + '\n', frontmatter);
}
