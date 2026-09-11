import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, type DB } from '../db/client.js';
import { blocks, habitInstances, habits } from '../db/schema.js';
import { registerScheduleRoutes } from './schedule.js';

describe('schedule routes', () => {
  let app: ReturnType<typeof Fastify> | undefined;

  afterEach(async () => { await app?.close(); });

  it('shows display-only habit occurrences without duplicating a planned habit block', async () => {
    const db: DB = createDb(':memory:');
    db.insert(habits).values([
      {
        id: 'scheduled-habit', name: 'Morning reading', durationMin: 30, rrule: 'FREQ=DAILY',
        preferredStart: '09:00', windowStart: '06:00', windowEnd: '22:00', priority: 2, kind: 'habit', active: 1,
      },
      {
        id: 'avoidance-habit', name: 'No smoking', durationMin: 15, rrule: 'FREQ=DAILY',
        preferredStart: '10:00', windowStart: '06:00', windowEnd: '22:00', priority: 2, kind: 'negative', active: 1,
      },
    ]).run();
    db.insert(habitInstances).values([
      { id: 'scheduled-instance', habitId: 'scheduled-habit', date: '2026-09-01', status: 'planned' },
      { id: 'avoidance-instance', habitId: 'avoidance-habit', date: '2026-09-01', status: 'lapsed' },
    ]).run();
    db.insert(blocks).values({
      id: 'planned-habit-block', habitInstanceId: 'scheduled-instance', startUtc: '2026-09-01T06:00:00.000Z',
      endUtc: '2026-09-01T06:30:00.000Z', status: 'scheduled', reasons: '[]', chunkIndex: 0,
    }).run();

    app = Fastify();
    registerScheduleRoutes(app, db);
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/schedule?from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-02T00%3A00%3A00.000Z&external=0' });
    expect(response.statusCode).toBe(200);
    const items = response.json() as Array<{ id: string; status?: string; habitKind?: string; isHabitOccurrence?: boolean; editable: boolean }>;

    expect(items).toContainEqual(expect.objectContaining({ id: 'planned-habit-block' }));
    expect(items).not.toContainEqual(expect.objectContaining({ id: 'habit:scheduled-habit:2026-09-01' }));
    expect(items).toContainEqual(expect.objectContaining({
      id: 'habit:avoidance-habit:2026-09-01', status: 'lapsed', habitKind: 'negative', isHabitOccurrence: true, editable: false,
    }));
  });
});
