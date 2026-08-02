import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  WorkoutBodyweightInputSchema,
  WorkoutCredentialInputSchema,
  WorkoutExerciseHistoryQuerySchema,
  WorkoutExerciseHistorySchema,
  WorkoutGoalInputSchema,
  WorkoutNoteInputSchema,
  WorkoutPredictInputSchema,
  WorkoutRoutinePushInputSchema,
  WorkoutSummarySchema,
  WorkoutSyncInputSchema,
} from '@timeblock/shared';
import { WORKOUT_DATA_DIR } from '../config.js';
import { WorkoutEngineService } from '../workout/engine.js';

function validationError(reply: { code(status: number): { send(value: unknown): unknown } }, error: unknown) {
  return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid workout request.' });
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function registerWorkoutRoutes(app: FastifyInstance, engine: WorkoutEngineService) {
  app.get('/workout/status', async () => {
    try {
      const status = await engine.execute<Record<string, unknown>>('status');
      return { engineAvailable: true, ...status, activeJob: engine.activeJob() };
    } catch {
      return { engineAvailable: engine.available(), sets: 0, sessions: 0, latestSession: null, adherencePct: null, adherence: {}, hevyConnected: false, summaryAvailable: false, activeJob: engine.activeJob() };
    }
  });

  app.get('/workout/settings', async (_req, reply) => {
    try {
      return await engine.execute<Record<string, unknown>>('settings');
    } catch (error) {
      return reply.code(503).send({ error: error instanceof Error ? error.message : 'Workout settings are unavailable.' });
    }
  });

  app.get('/workout/summary', async (_req, reply) => {
    try {
      const parsed = WorkoutSummarySchema.parse(JSON.parse(await fs.readFile(engine.summaryPath(), 'utf8')));
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reply.code(404).send({ error: 'No workout summary exists yet. Import or sync your history first.' });
      return reply.code(500).send({ error: error instanceof Error ? error.message : 'Workout summary could not be read.' });
    }
  });

  app.get<{ Params: { exercise: string }; Querystring: { from?: string; to?: string } }>(
    '/workout/exercises/:exercise/history',
    async (req, reply) => {
      try {
        const range = WorkoutExerciseHistoryQuerySchema.parse(req.query ?? {});
        const result = await engine.execute('exercise-history', { exercise: req.params.exercise, ...range });
        return WorkoutExerciseHistorySchema.parse(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Exercise history could not be read.';
        if (message.includes('No workout history exists')) return reply.code(404).send({ error: message });
        if (message.includes('from') || message.includes('date')) return validationError(reply, error);
        return reply.code(500).send({ error: message });
      }
    },
  );

  app.get<{ Params: { id: string } }>('/workout/jobs/:id', async (req, reply) => {
    const job = engine.getJob(req.params.id);
    return job ?? reply.code(404).send({ error: 'Workout job not found.' });
  });
  app.get('/workout/jobs', async () => engine.listJobs());

  app.put<{ Body: unknown }>('/workout/settings/credential', async (req, reply) => {
    try {
      const { apiKey } = WorkoutCredentialInputSchema.parse(req.body);
      await engine.saveCredential(apiKey);
      return { saved: true, hevyConnected: true };
    } catch (error) { return validationError(reply, error); }
  });

  app.post<{ Body: unknown }>('/workout/sync', async (req, reply) => {
    try { return reply.code(202).send(engine.enqueue('sync', WorkoutSyncInputSchema.parse(req.body ?? {}))); }
    catch (error) { return validationError(reply, error); }
  });
  app.post<{ Body: unknown }>('/workout/report', async (req, reply) => reply.code(202).send(engine.enqueue('report', (req.body as Record<string, unknown>) ?? {})));
  app.post('/workout/backtest', async (_req, reply) => reply.code(202).send(engine.enqueue('backtest')));
  app.post<{ Body: unknown }>('/workout/bodyweight', async (req, reply) => {
    try { return reply.code(202).send(engine.enqueue('log-bodyweight', WorkoutBodyweightInputSchema.parse(req.body))); }
    catch (error) { return validationError(reply, error); }
  });
  app.post<{ Body: unknown }>('/workout/goals', async (req, reply) => {
    try { return reply.code(202).send(engine.enqueue('set-goal', WorkoutGoalInputSchema.parse(req.body))); }
    catch (error) { return validationError(reply, error); }
  });
  app.post<{ Body: unknown }>('/workout/notes', async (req, reply) => {
    try { return reply.code(202).send(engine.enqueue('note', WorkoutNoteInputSchema.parse(req.body))); }
    catch (error) { return validationError(reply, error); }
  });
  app.post<{ Body: unknown }>('/workout/predict', async (req, reply) => {
    try { return reply.code(202).send(engine.enqueue('predict', WorkoutPredictInputSchema.parse(req.body))); }
    catch (error) { return validationError(reply, error); }
  });
  app.post<{ Body: Record<string, unknown> }>('/workout/calibrate', async (req, reply) => reply.code(202).send(engine.enqueue('calibrate', req.body ?? {})));
  app.post<{ Body: Record<string, unknown> }>('/workout/compare', async (req, reply) => reply.code(202).send(engine.enqueue('compare', req.body ?? {})));
  app.post<{ Body: Record<string, unknown> }>('/workout/set-plan', async (req, reply) => reply.code(202).send(engine.enqueue('set-plan', req.body ?? {})));
  app.post<{ Body: Record<string, unknown> }>('/workout/routines/preview', async (req, reply) => reply.code(202).send(engine.enqueue('routine-preview', req.body ?? {})));
  app.post<{ Body: unknown }>('/workout/routines/apply', async (req, reply) => {
    try { return reply.code(202).send(engine.enqueue('routine-push', WorkoutRoutinePushInputSchema.parse(req.body))); }
    catch (error) { return validationError(reply, error); }
  });

  app.post('/workout/import', async (req, reply) => {
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'Choose a Hevy CSV export.' });
    if (!part.filename.toLowerCase().endsWith('.csv')) { part.file.resume(); return reply.code(415).send({ error: 'Workout import requires a CSV file.' }); }
    const importsDir = path.join(WORKOUT_DATA_DIR, 'imports');
    await fs.mkdir(importsDir, { recursive: true });
    const destination = path.join(importsDir, `${crypto.randomUUID()}.csv`);
    await fs.writeFile(destination, await part.toBuffer());
    return reply.code(202).send(engine.enqueue('import-csv', { path: destination, deleteAfterImport: true }));
  });

  app.get<{ Params: { format: string } }>('/workout/exports/:format', async (req, reply) => {
    const summary = WorkoutSummarySchema.parse(JSON.parse(await fs.readFile(engine.summaryPath(), 'utf8')));
    if (req.params.format === 'json') return reply.header('Content-Disposition', 'attachment; filename="workout-summary.json"').send(summary);
    if (req.params.format === 'lifts.csv') {
      const rows = [['Exercise', 'Muscle', 'Status', 'Sessions', 'Best e1RM', 'Last trained'], ...summary.exercises.map((exercise) => [exercise.name, exercise.muscle, exercise.status, exercise.n_sessions, exercise.best_e1rm, exercise.last_trained])];
      return reply.type('text/csv').header('Content-Disposition', 'attachment; filename="workout-lifts.csv"').send(rows.map((row) => row.map(csvCell).join(',')).join('\n'));
    }
    return reply.code(404).send({ error: 'Unknown workout export format.' });
  });
}
