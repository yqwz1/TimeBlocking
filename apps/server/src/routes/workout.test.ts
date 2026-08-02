import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkoutJobDTO } from '@timeblock/shared';
import type { WorkoutEngineService } from '../workout/engine.js';
import { registerWorkoutRoutes } from './workout.js';

function job(command: string): WorkoutJobDTO {
  const now = new Date().toISOString();
  return { id: `job-${command}`, command, status: 'queued', progress: 0, result: null, error: null, createdAtUtc: now, updatedAtUtc: now, completedAtUtc: null };
}

describe('workout routes', () => {
  let app: ReturnType<typeof Fastify>;
  let savedCredential = '';
  let enqueued: Array<{ command: string; payload: Record<string, unknown> }>;
  let executed: Array<{ command: string; payload: Record<string, unknown> }>;

  beforeEach(async () => {
    savedCredential = '';
    enqueued = [];
    executed = [];
    const engine = {
      available: () => true,
      activeJob: () => null,
      getJob: () => null,
      listJobs: () => [],
      summaryPath: () => 'missing-summary.json',
      execute: async (command: string, payload: Record<string, unknown> = {}) => {
        executed.push({ command, payload });
        if (command === 'exercise-history') {
          if (payload.exercise === 'Missing lift') throw new Error("No workout history exists for 'Missing lift'");
          return {
            schema_version: 1,
            exercise: payload.exercise,
            muscle: 'chest',
            epochs: [{ epoch: 0, first_date: '2026-07-01', last_date: '2026-07-08', sessions: 2 }],
            sessions: [{
              date: '2026-07-08', title: 'Upper', duration_min: 52, total_volume: 1500,
              working_sets: 3, top_weight: 100, top_reps: 5, top_e1rm: 116.7,
              sets: [{ index: 0, type: 'normal', weight: 100, reps: 5, rpe: 8, rir: 2, rest_seconds: 180, e1rm: 116.7, volume: 500, epoch: 0, is_working: true, quality_flag: null }],
            }],
          };
        }
        return { sets: 12, sessions: 3, latestSession: '2026-07-21', adherencePct: 41, adherence: {}, hevyConnected: true, summaryAvailable: true };
      },
      saveCredential: async (value: string) => { savedCredential = value; },
      enqueue: (command: string, payload: Record<string, unknown> = {}) => { enqueued.push({ command, payload }); return job(command); },
    } as unknown as WorkoutEngineService;
    app = Fastify();
    await app.register(multipart);
    registerWorkoutRoutes(app, engine);
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('reports engine state without exposing the credential', async () => {
    const response = await app.inject({ method: 'GET', url: '/workout/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ engineAvailable: true, sets: 12, hevyConnected: true });
    expect(response.body).not.toMatch(/api.?key|hevy_api_key/i);
  });

  it('stores a credential but never echoes it', async () => {
    const response = await app.inject({ method: 'PUT', url: '/workout/settings/credential', payload: { apiKey: 'private-hevy-key' } });
    expect(response.statusCode).toBe(200);
    expect(savedCredential).toBe('private-hevy-key');
    expect(response.body).not.toContain('private-hevy-key');
  });

  it('validates coaching mutations and routine confirmation', async () => {
    expect((await app.inject({ method: 'POST', url: '/workout/bodyweight', payload: { weight: -1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/workout/goals', payload: { exercise: '', metric: 'e1rm', value: 100 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/workout/routines/apply', payload: { previewHash: 'a'.repeat(64), confirm: false } })).statusCode).toBe(400);

    const valid = await app.inject({ method: 'POST', url: '/workout/routines/apply', payload: { previewHash: 'a'.repeat(64), confirm: true } });
    expect(valid.statusCode).toBe(202);
    expect(enqueued.at(-1)).toMatchObject({ command: 'routine-push', payload: { confirm: true } });
  });

  it('rejects non-CSV imports before enqueueing work', async () => {
    const response = await app.inject({ method: 'POST', url: '/workout/import', payload: Buffer.from('not csv'), headers: { 'content-type': 'text/plain' } });
    expect(response.statusCode).toBe(406);
    expect(enqueued).toHaveLength(0);
  });

  it('returns complete, filtered exercise history through a parameterized command', async () => {
    const response = await app.inject({ method: 'GET', url: '/workout/exercises/Bench%20Press/history?from=2026-07-01&to=2026-07-31' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schema_version: 1, exercise: 'Bench Press', sessions: [{ sets: [{ weight: 100, reps: 5, rpe: 8, rir: 2, epoch: 0, is_working: true }] }] });
    expect(executed.at(-1)).toEqual({ command: 'exercise-history', payload: { exercise: 'Bench Press', from: '2026-07-01', to: '2026-07-31' } });
    expect(response.body).not.toMatch(/api.?key|credential|hevy_api_key/i);
  });

  it('rejects unsafe ranges and reports unknown exercises without executing arbitrary input', async () => {
    const invalid = await app.inject({ method: 'GET', url: '/workout/exercises/Bench%20Press/history?from=2026-08-01&to=2026-07-01' });
    expect(invalid.statusCode).toBe(400);
    expect(executed.filter((item) => item.command === 'exercise-history')).toHaveLength(0);

    const missing = await app.inject({ method: 'GET', url: '/workout/exercises/Missing%20lift/history' });
    expect(missing.statusCode).toBe(404);
  });
});
