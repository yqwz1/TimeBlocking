import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, env } from '../../config.js';

export interface IntegrationEvent {
  id: string;
  type: string;
  at: string;
  data: Record<string, unknown>;
}

const EVENT_PATH = path.join(DATA_DIR, 'integration-events.jsonl');

export async function appendIntegrationEvent(type: string, data: Record<string, unknown>): Promise<void> {
  if (!env.integrationEventLog) return;
  await fs.mkdir(path.dirname(EVENT_PATH), { recursive: true });
  const event: IntegrationEvent = { id: randomUUID(), type, at: new Date().toISOString(), data };
  await fs.appendFile(EVENT_PATH, `${JSON.stringify(event)}\n`, 'utf8');
}

export async function readIntegrationEvents(after?: string): Promise<IntegrationEvent[]> {
  if (!env.integrationEventLog) return [];
  let raw: string;
  try {
    raw = await fs.readFile(EVENT_PATH, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const events = raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as IntegrationEvent]; } catch { return []; }
  });
  if (!after) return events.slice(-200);
  const index = events.findIndex((event) => event.id === after);
  return (index >= 0 ? events.slice(index + 1) : events).slice(-200);
}
