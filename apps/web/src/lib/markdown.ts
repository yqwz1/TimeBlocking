/**
 * A small, dependency-free markdown -> HTML renderer for the note preview pane.
 * Not CommonMark-complete — covers the subset Phase 1 promises (headings, bold/italic,
 * inline code, fenced code blocks, lists incl. checkboxes, blockquotes, hr, links, images,
 * wikilinks, inline #tags) plus wikilink/tag click-through hooks the editor wires up.
 */

export interface WikilinkResolution {
  id: string | null;
}

export interface MarkdownOptions {
  resolveWikilink: (target: string) => WikilinkResolution;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Matches the sentinel private-use characters the server wraps FTS match hits in
// (see SNIPPET_MARK_START/END in apps/server/src/notes/indexer.ts).
const SNIPPET_MARK_START = '\uE000';
const SNIPPET_MARK_END = '\uE001';

/** Escapes an FTS snippet (untrusted note content) then turns the server's match sentinels into <mark>. */
export function highlightSnippet(snippet: string): string {
  return escapeHtml(snippet).split(SNIPPET_MARK_START).join('<mark>').split(SNIPPET_MARK_END).join('</mark>');
}

/** Strips a leading YAML frontmatter block, if present, returning the body and how many lines it occupied. */
export function stripFrontmatter(raw: string): { body: string; frontmatterLineCount: number } {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!m) return { body: raw, frontmatterLineCount: 0 };
  return { body: raw.slice(m[0].length), frontmatterLineCount: m[0].split('\n').length - 1 };
}

function renderInline(text: string, opts: MarkdownOptions): string {
  let out = escapeHtml(text);
  // images ![alt](src)
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, src: string) => {
    const url = /^(https?:)?\/\//.test(src) ? src : `/api/notes/asset/${src.split('/').map(encodeURIComponent).join('/')}`;
    return `<img src="${url}" alt="${alt}" loading="lazy" />`;
  });
  // links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  // wikilinks [[Target]] / [[Target|Alias]] / [[Target#heading]]
  out = out.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => {
    const t = target.trim();
    const { id } = opts.resolveWikilink(t);
    const label = (alias ?? t).trim();
    const cls = id ? 'wikilink' : 'wikilink wikilink-missing';
    return `<a href="#" class="${cls}" data-wikilink-target="${escapeHtml(t)}" data-wikilink-id="${id ?? ''}">${label}</a>`;
  });
  // inline tags #tag (not inside a URL/word)
  out = out.replace(/(^|[\s(])#([a-zA-Z][\w\-/]*)/g, (_m, pre: string, tag: string) => `${pre}<span class="tag" data-tag="${tag}">#${tag}</span>`);
  // bold, italic, inline code (order matters: bold before italic)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  return out;
}

interface ListItem {
  line: number;
  indent: number;
  ordered: boolean;
  checked: boolean | null; // null = not a checkbox item
  text: string;
}

function flushList(items: ListItem[], opts: MarkdownOptions): string {
  if (items.length === 0) return '';
  // Simple single-level rendering (indentation nesting kept minimal for Phase 1).
  const ordered = items[0].ordered;
  const tag = ordered ? 'ol' : 'ul';
  const rows = items
    .map((item) => {
      if (item.checked !== null) {
        return `<li class="task-item"><label><input type="checkbox" data-line="${item.line}" ${item.checked ? 'checked' : ''} /> <span>${renderInline(item.text, opts)}</span></label></li>`;
      }
      return `<li>${renderInline(item.text, opts)}</li>`;
    })
    .join('');
  return `<${tag}>${rows}</${tag}>`;
}

export function renderMarkdown(body: string, opts: MarkdownOptions): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  let listBuf: ListItem[] = [];
  let quoteBuf: string[] = [];

  const flushQuote = () => {
    if (quoteBuf.length) {
      out.push(`<blockquote>${quoteBuf.map((l) => renderInline(l, opts)).join('<br/>')}</blockquote>`);
      quoteBuf = [];
    }
  };
  const flushListBuf = () => {
    if (listBuf.length) {
      out.push(flushList(listBuf, opts));
      listBuf = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flushListBuf();
      flushQuote();
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      out.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushListBuf();
      flushQuote();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2], opts)}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line) && line.trim().length >= 3) {
      flushListBuf();
      flushQuote();
      out.push('<hr/>');
      i++;
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushListBuf();
      quoteBuf.push(quote[1]);
      i++;
      continue;
    }
    flushQuote();

    const checkbox = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    const bullet = !checkbox && line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = !checkbox && !bullet && line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (checkbox || bullet || numbered) {
      const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
      if (checkbox) listBuf.push({ line: i, indent, ordered: false, checked: /x/i.test(checkbox[1]), text: checkbox[2] });
      else if (bullet) listBuf.push({ line: i, indent, ordered: false, checked: null, text: bullet[1] });
      else if (numbered) listBuf.push({ line: i, indent, ordered: true, checked: null, text: numbered[1] });
      i++;
      continue;
    }
    flushListBuf();

    if (line.trim() === '') {
      i++;
      continue;
    }

    out.push(`<p>${renderInline(line, opts)}</p>`);
    i++;
  }
  flushListBuf();
  flushQuote();
  return out.join('\n');
}

/** Flips a `- [ ]`/`- [x]` checkbox on one line of the raw note content (frontmatter included) and returns the new content. */
export function toggleCheckboxAtLine(raw: string, frontmatterLineCount: number, bodyLine: number): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const idx = frontmatterLineCount + bodyLine;
  if (idx < 0 || idx >= lines.length) return raw;
  lines[idx] = lines[idx].replace(/\[( |x|X)\]/, (m) => (m.toLowerCase() === '[x]' ? '[ ]' : '[x]'));
  return lines.join('\n');
}
