import { DateTime } from 'luxon';
import type { NoteQueryDefinitionDTO, NoteQueryResultDTO, NoteQuerySort, NoteQueryTaskState, NoteQueryTaskRowDTO, VaultTaskDTO } from '@timeblock/shared';
import { nodeMetrics, notes } from '../db/schema.js';
import type { DB } from '../db/client.js';
import { extractMarkdownTasks } from '../integrations/secondBrain/tasks.js';
import { readNoteFile } from './vault.js';

type NoteRow = typeof notes.$inferSelect;

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseDateRange(value: string): { from: string | null; to: string | null } {
  const [left, right] = value.split('..', 2).map((part) => part?.trim() ?? '');
  if (value.includes('..')) return { from: left || null, to: right || null };
  return { from: value || null, to: value || null };
}

function tokenValue(raw: string): string {
  return raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

export function parseNoteQuery(raw: string): NoteQueryDefinitionDTO {
  const out: NoteQueryDefinitionDTO = {
    raw,
    tags: [],
    folders: [],
    task: null,
    text: null,
    createdFrom: null,
    createdTo: null,
    modifiedFrom: null,
    modifiedTo: null,
    sort: 'modified',
  };
  const pattern = /(\w+):(".*?"|\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw))) {
    const key = match[1].toLowerCase();
    const value = tokenValue(match[2].trim());
    if (!value) continue;
    if (key === 'tag') out.tags.push(value);
    else if (key === 'folder') out.folders.push(value);
    else if (key === 'task' && ['open', 'done', 'all'].includes(value)) out.task = value as NoteQueryTaskState;
    else if (key === 'text') out.text = value;
    else if (key === 'created') {
      const range = parseDateRange(value);
      out.createdFrom = range.from;
      out.createdTo = range.to;
    } else if (key === 'modified') {
      const range = parseDateRange(value);
      out.modifiedFrom = range.from;
      out.modifiedTo = range.to;
    } else if (key === 'sort' && ['modified', 'created', 'title'].includes(value)) out.sort = value as NoteQuerySort;
  }
  return out;
}

function folderOf(id: string): string {
  return id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
}

function localDate(value: string | null, timezone: string): string | null {
  if (!value) return null;
  const parsed = DateTime.fromISO(value, { zone: 'utc' });
  return parsed.isValid ? parsed.setZone(timezone).toISODate() : null;
}

function inRange(value: string | null, from: string | null, to: string | null): boolean {
  if (!from && !to) return true;
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

function matchesNoteFilters(row: NoteRow, query: NoteQueryDefinitionDTO, timezone: string, body: string | null): boolean {
  const tags = parseJsonArray(row.tags);
  if (query.tags.length && !query.tags.every((tag) => tags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase()))) return false;
  const folder = folderOf(row.id);
  if (query.folders.length && !query.folders.some((candidate) => folder.toLowerCase().startsWith(candidate.toLowerCase()))) return false;
  if (!inRange(localDate(row.createdAtUtc, timezone), query.createdFrom, query.createdTo)) return false;
  if (!inRange(localDate(row.updatedAtUtc, timezone), query.modifiedFrom, query.modifiedTo)) return false;
  if (query.text) {
    const haystack = `${row.title}\n${tags.join(' ')}\n${body ?? ''}`.toLowerCase();
    if (!haystack.includes(query.text.toLowerCase())) return false;
  }
  return true;
}

function sortNotes<T extends { title: string; createdAt: string | null; updatedAt: string | null }>(rows: T[], sort: NoteQuerySort): T[] {
  return rows.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'created') return (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.title.localeCompare(b.title);
    return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.title.localeCompare(b.title);
  });
}

export async function runNoteQuery(db: DB, root: string, raw: string, timezone: string): Promise<NoteQueryResultDTO> {
  const query = parseNoteQuery(raw);
  const rows = db.select().from(notes).all();
  const openTasksById = new Map(db.select().from(nodeMetrics).all().map((metric) => [metric.noteId, metric.openTasks]));

  if (query.task) {
    const tasks: NoteQueryTaskRowDTO[] = [];
    for (const row of rows) {
      const file = await readNoteFile(root, row.id);
      const body = file?.content ?? null;
      if (!matchesNoteFilters(row, query, timezone, body)) continue;
      for (const task of extractMarkdownTasks(row.id, row.title, parseJsonArray(row.tags), body ?? '')) {
        if (query.task === 'open' && task.completed) continue;
        if (query.task === 'done' && !task.completed) continue;
        tasks.push({
          kind: 'task',
          id: task.id,
          noteId: row.id,
          noteTitle: row.title,
          notePath: row.id,
          line: task.line,
          text: task.text,
          completed: task.completed,
          tags: task.tags,
          due: task.due,
          estimateMinutes: task.estimateMinutes,
          status: task.status,
        });
      }
    }
    tasks.sort((a, b) => {
      if (query.sort === 'title') return a.noteTitle.localeCompare(b.noteTitle) || a.line - b.line;
      const noteA = rows.find((row) => row.id === a.noteId);
      const noteB = rows.find((row) => row.id === b.noteId);
      const left = query.sort === 'created' ? noteA?.createdAtUtc ?? '' : noteA?.updatedAtUtc ?? '';
      const right = query.sort === 'created' ? noteB?.createdAtUtc ?? '' : noteB?.updatedAtUtc ?? '';
      return right.localeCompare(left) || a.noteTitle.localeCompare(b.noteTitle) || a.line - b.line;
    });
    return { query, resultKind: 'tasks', rows: tasks };
  }

  const notesOut = [];
  for (const row of rows) {
    const needsBody = !!query.text;
    const body = needsBody ? (await readNoteFile(root, row.id))?.content ?? null : null;
    if (!matchesNoteFilters(row, query, timezone, body)) continue;
    notesOut.push({
      kind: 'note' as const,
      id: row.id,
      title: row.title,
      tags: parseJsonArray(row.tags),
      folder: folderOf(row.id),
      openTasks: openTasksById.get(row.id) ?? 0,
      createdAt: row.createdAtUtc,
      updatedAt: row.updatedAtUtc,
    });
  }
  sortNotes(notesOut, query.sort);
  return { query, resultKind: 'notes', rows: notesOut };
}
