import { DateTime } from 'luxon';
import type { OnThisDayBucketDTO, OnThisDayDTO } from '@timeblock/shared';
import { nodeMetrics, notes } from '../db/schema.js';
import type { DB } from '../db/client.js';

function folderOf(id: string): string {
  return id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '';
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function matchBucketDate(value: string | null, target: string, timezone: string): boolean {
  if (!value) return false;
  const parsed = DateTime.fromISO(value, { zone: 'utc' });
  return parsed.isValid && parsed.setZone(timezone).toISODate() === target;
}

export function getOnThisDay(db: DB, date: string, timezone: string): OnThisDayDTO {
  const base = DateTime.fromISO(date, { zone: timezone });
  const metricById = new Map(db.select().from(nodeMetrics).all().map((metric) => [metric.noteId, metric.openTasks]));
  const buckets: Array<{ label: string; target: string }> = [
    { label: '1 week ago', target: base.minus({ weeks: 1 }).toISODate()! },
    { label: '1 month ago', target: base.minus({ months: 1 }).toISODate()! },
    { label: '1 year ago', target: base.minus({ years: 1 }).toISODate()! },
  ];

  const rows = db.select().from(notes).all();
  const data: OnThisDayBucketDTO[] = buckets.map((bucket) => ({
    label: bucket.label,
    anchorDate: bucket.target,
    notes: rows
      .filter((row) => matchBucketDate(row.updatedAtUtc, bucket.target, timezone) || matchBucketDate(row.createdAtUtc, bucket.target, timezone))
      .map((row) => ({
        kind: 'note' as const,
        id: row.id,
        title: row.title,
        tags: parseTags(row.tags),
        folder: folderOf(row.id),
        openTasks: metricById.get(row.id) ?? 0,
        createdAt: row.createdAtUtc,
        updatedAt: row.updatedAtUtc,
      }))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.title.localeCompare(b.title)),
  }));

  return { date, buckets: data };
}
