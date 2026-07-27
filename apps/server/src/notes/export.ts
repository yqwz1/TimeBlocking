import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import archiver from 'archiver';
import type { NoteExportFormat, NoteExportKind } from '@timeblock/shared';
import { eq } from 'drizzle-orm';
import { notes } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { readNoteFile } from './vault.js';

const execFileAsync = promisify(execFile);

interface ExportNote {
  id: string;
  title: string;
  content: string;
}

interface ExportResult {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function htmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function slugify(value: string): string {
  const cleaned = value.trim().replace(/[/\\]+/g, '-').replace(/\s+/g, '-');
  return cleaned.replace(/[^A-Za-z0-9._-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'export';
}

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function linesToDocxParagraphs(lines: string[]): string {
  const paragraphs: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      paragraphs.push('<w:p/>');
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="Heading${Math.min(3, heading[1].length)}"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(heading[2])}</w:t></w:r></w:p>`);
      continue;
    }
    const checkbox = /^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/.exec(line);
    if (checkbox) {
      paragraphs.push(`<w:p><w:r><w:t xml:space="preserve">${checkbox[1].toLowerCase() === 'x' ? '☑' : '☐'} ${xmlEscape(checkbox[2])}</w:t></w:r></w:p>`);
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      paragraphs.push(`<w:p><w:r><w:t xml:space="preserve">• ${xmlEscape(bullet[1])}</w:t></w:r></w:p>`);
      continue;
    }
    paragraphs.push(`<w:p><w:r><w:t xml:space="preserve">${xmlEscape(trimmed)}</w:t></w:r></w:p>`);
  }
  return paragraphs.join('');
}

function markdownToHtml(content: string): string {
  const lines = stripFrontmatter(content).split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  let inCode = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ');
    if (/^```/.test(line)) {
      if (inCode) out.push('</code></pre>');
      else out.push('<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(`${htmlEscape(line)}\n`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      const level = Math.min(6, heading[1].length);
      out.push(`<h${level}>${htmlEscape(heading[2])}</h${level}>`);
      continue;
    }
    const checkbox = /^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (checkbox || bullet) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      const text = checkbox ? `${checkbox[1].toLowerCase() === 'x' ? '☑' : '☐'} ${checkbox[2]}` : bullet![1];
      out.push(`<li>${htmlEscape(text)}</li>`);
      continue;
    }
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
    if (!line.trim()) {
      out.push('<div class="spacer"></div>');
      continue;
    }
    out.push(`<p>${htmlEscape(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

async function buildDocx(notesToExport: ExportNote[]): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  const done = new Promise<Buffer>((resolve, reject) => {
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
  });
  archive.pipe(stream);

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${notesToExport
      .map(
        (note, index) =>
          `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(note.title)}</w:t></w:r></w:p>${linesToDocxParagraphs(stripFrontmatter(note.content).split(/\r?\n/))}${
            index < notesToExport.length - 1 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ''
          }`,
      )
      .join('')}
    <w:sectPr />
  </w:body>
</w:document>`;

  archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`, { name: '[Content_Types].xml' });
  archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`, { name: '_rels/.rels' });
  archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="Heading 3"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
</w:styles>`, { name: 'word/styles.xml' });
  archive.append(documentXml, { name: 'word/document.xml' });
  archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`, { name: 'word/_rels/document.xml.rels' });
  await archive.finalize();
  return done;
}

function browserCandidates(): string[] {
  return [
    process.env.TB_PDF_BROWSER || '',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
}

async function resolveBrowser(): Promise<string | null> {
  for (const candidate of browserCandidates()) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

async function buildPdf(notesToExport: ExportNote[], title: string): Promise<Buffer> {
  const browser = await resolveBrowser();
  if (!browser) throw new Error('No local headless browser found for PDF export.');

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tb-note-export-'));
  const htmlPath = path.join(tempDir, 'export.html');
  const pdfPath = path.join(tempDir, 'export.pdf');
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${htmlEscape(title)}</title>
  <style>
    body { font-family: "Segoe UI", "Noto Naskh Arabic", sans-serif; margin: 32px auto; max-width: 760px; color: #0f172a; line-height: 1.65; }
    article { page-break-after: always; }
    article:last-child { page-break-after: auto; }
    h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.2rem 0 0.6rem; }
    h1 { font-size: 2rem; }
    h2 { font-size: 1.5rem; }
    h3 { font-size: 1.2rem; }
    p, ul, pre { margin: 0.6rem 0; }
    ul { padding-inline-start: 1.3rem; }
    pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem; overflow: auto; white-space: pre-wrap; }
    .meta { color: #64748b; font-size: 0.9rem; margin-top: -0.25rem; }
    .spacer { height: 0.4rem; }
  </style>
</head>
<body>
  ${notesToExport
    .map(
      (note) => `<article><h1>${htmlEscape(note.title)}</h1><p class="meta">${htmlEscape(note.id)}</p>${markdownToHtml(note.content)}</article>`,
    )
    .join('')}
</body>
</html>`;
  await fs.writeFile(htmlPath, html, 'utf8');
  try {
    await execFileAsync(browser, ['--headless', '--disable-gpu', `--print-to-pdf=${pdfPath}`, htmlPath], { windowsHide: true });
    return await fs.readFile(pdfPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function collectNotes(db: DB, root: string, kind: NoteExportKind, target: string): Promise<ExportNote[]> {
  const rows = db.select().from(notes).all();
  const selected = rows.filter((row) => {
    if (kind === 'note') return row.id === target;
    return target ? row.id === target || row.id.startsWith(`${target}/`) : true;
  });
  const out: ExportNote[] = [];
  for (const row of selected.sort((a, b) => a.id.localeCompare(b.id))) {
    const file = await readNoteFile(root, row.id);
    if (file) out.push({ id: row.id, title: row.title, content: file.content });
  }
  return out;
}

export async function exportNotes(db: DB, root: string, kind: NoteExportKind, target: string, format: NoteExportFormat): Promise<ExportResult | null> {
  const notesToExport = await collectNotes(db, root, kind, target);
  if (notesToExport.length === 0) return null;
  const baseName = slugify(kind === 'note' ? notesToExport[0].title : target || 'vault');
  if (format === 'docx') {
    const bytes = await buildDocx(notesToExport);
    return {
      fileName: `${baseName}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes,
    };
  }
  const bytes = await buildPdf(notesToExport, baseName);
  return { fileName: `${baseName}.pdf`, mimeType: 'application/pdf', bytes };
}
