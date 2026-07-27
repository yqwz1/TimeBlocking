import { createHash } from 'node:crypto';

const CHECKBOX_RE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;
const DUE_RE = /@due\((\d{4}-\d{2}-\d{2})\)/i;
const ESTIMATE_RE = /#time-estimate(?:\(|:)(\d+(?:\.\d+)?)(m|h)\)?/i;
const STATUS_RE = /\bstatus::([a-z0-9_-]+)\b/i;
const TAG_RE = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;

export interface MarkdownTask {
  id: string;
  notePath: string;
  noteTitle: string;
  line: number;
  text: string;
  completed: boolean;
  tags: string[];
  due: string | null;
  estimateMinutes: number | null;
  status: string | null;
}

function taskId(notePath: string, line: number, text: string): string {
  return createHash('sha256').update(`${notePath}\n${line}\n${text}`).digest('base64url').slice(0, 24);
}

export function extractMarkdownTasks(notePath: string, noteTitle: string, noteTags: string[], content: string): MarkdownTask[] {
  const out: MarkdownTask[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(CHECKBOX_RE);
    if (!match) continue;
    const text = match[4].trim();
    const estimate = text.match(ESTIMATE_RE);
    const inlineTags: string[] = [];
    TAG_RE.lastIndex = 0;
    let tag: RegExpExecArray | null;
    while ((tag = TAG_RE.exec(text))) if (tag[2].toLowerCase() !== 'time-estimate') inlineTags.push(tag[2]);
    const amount = estimate ? Number(estimate[1]) : NaN;
    out.push({
      id: taskId(notePath, index + 1, text),
      notePath,
      noteTitle,
      line: index + 1,
      text,
      completed: match[2].toLowerCase() === 'x',
      tags: [...new Set([...noteTags, ...inlineTags])],
      due: text.match(DUE_RE)?.[1] ?? null,
      estimateMinutes: Number.isFinite(amount) ? Math.round(amount * (estimate?.[2].toLowerCase() === 'h' ? 60 : 1)) : null,
      status: text.match(STATUS_RE)?.[1]?.toLowerCase() ?? null,
    });
  }
  return out;
}

export function completeMarkdownTask(content: string, id: string, notePath: string, noteTitle: string, noteTags: string[]): string | null {
  const tasks = extractMarkdownTasks(notePath, noteTitle, noteTags, content);
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) return null;
  if (task.completed) return content;
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  lines[task.line - 1] = lines[task.line - 1].replace(CHECKBOX_RE, '$1x$3$4');
  return lines.join(newline);
}
