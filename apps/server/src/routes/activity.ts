import type { FastifyInstance } from 'fastify';
import { ActivityAiAnalyzeInputSchema, ActivityAiPreviewInputSchema, ActivityClassificationRuleInputSchema, ActivityConnectInputSchema, ActivityCorrectionInputSchema, FocusWorkSessionInputSchema } from '@timeblock/shared';
import { z } from 'zod';
import { desc } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { ActivityWatchAdapter } from '../integrations/activitywatch/adapter.js';
import { ModelGateway } from '../assistant/modelGateway.js';
import { ActivityAiPreviewError, type ActivityAiGateway, analyzeActivityAiPreview, connectActivityWatch, correctBlockActivitySummary, createActivityAiPreview, getActivityAnalytics, getActivityPersonalAnalytics, getActivityStatus, getBlockActivitySummary, listActivityRecommendations, refreshActivityWatchHealth, updateActivityRecommendation } from '../activity/service.js';
import { getSettings } from '../settings.js';
import { getActivitySyncService } from '../activity/sync.js';
import { createActivityExperiment, createClassificationRule, deleteClassificationRule, getActivityCenterOverview, getActivityTimeline, listClassificationRules, recordFocusWorkSession } from '../activity/center.js';
import { activityExperiments } from '../db/schema.js';

export interface ActivityRouteOptions {
  createAdapter?: (port: number) => ActivityWatchAdapter;
  createModelGateway?: (db: DB) => ActivityAiGateway;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'ActivityWatch connection failed.';
}

export function registerActivityRoutes(app: FastifyInstance, db: DB, options: ActivityRouteOptions = {}) {
  const createAdapter = options.createAdapter;
  const createModelGateway = options.createModelGateway ?? ((database: DB) => new ModelGateway(database));

  app.get('/activity/status', async () => getActivityStatus(db));

  const validRange = (from: string | undefined, to: string | undefined) => !!from && !!to && !Number.isNaN(Date.parse(from)) && !Number.isNaN(Date.parse(to)) && from < to;
  app.get<{ Querystring: { from?: string; to?: string } }>('/activity/center/overview', async (req, reply) => {
    if (!validRange(req.query.from, req.query.to)) return reply.code(400).send({ error: 'Valid from and to UTC ISO timestamps are required.' });
    return getActivityCenterOverview(db, req.query.from!, req.query.to!);
  });
  app.get<{ Querystring: { from?: string; to?: string } }>('/activity/center/timeline', async (req, reply) => {
    if (!validRange(req.query.from, req.query.to)) return reply.code(400).send({ error: 'Valid from and to UTC ISO timestamps are required.' });
    return getActivityTimeline(db, req.query.from!, req.query.to!);
  });
  app.get<{ Querystring: { from?: string; to?: string } }>('/activity/center/patterns', async (req, reply) => {
    if (!validRange(req.query.from, req.query.to)) return reply.code(400).send({ error: 'Valid from and to UTC ISO timestamps are required.' });
    return getActivityCenterOverview(db, req.query.from!, req.query.to!);
  });
  app.get('/activity/classification-rules', async () => listClassificationRules(db));
  app.post<{ Body: unknown }>('/activity/classification-rules', async (req, reply) => {
    const parsed = ActivityClassificationRuleInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid classification rule.' });
    return createClassificationRule(db, parsed.data);
  });
  app.delete<{ Params: { id: string } }>('/activity/classification-rules/:id', async (req, reply) => deleteClassificationRule(db, req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: 'Classification rule not found.' }));
  app.post<{ Body: unknown }>('/activity/focus-work-sessions', async (req, reply) => {
    const parsed = FocusWorkSessionInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid Focus Timer event.' });
    recordFocusWorkSession(db, parsed.data);
    return reply.code(204).send();
  });
  const ExperimentInputSchema = z.object({ kind: z.enum(['focus_window', 'block_length', 'meeting_buffer', 'communication_batching', 'browser_boundary', 'estimate_adjustment']), title: z.string().trim().min(1).max(160), detail: z.string().trim().min(1).max(1000), endsAtUtc: z.string().datetime() });
  app.get('/activity/experiments', async () => db.select().from(activityExperiments).orderBy(desc(activityExperiments.createdAtUtc)).all());
  app.post<{ Body: unknown }>('/activity/experiments', async (req, reply) => {
    const parsed = ExperimentInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid experiment.' });
    return createActivityExperiment(db, parsed.data);
  });

  app.post<{ Body: unknown }>('/activity/connect', async (req, reply) => {
    const parsed = ActivityConnectInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid ActivityWatch connection settings.' });
    try {
      return await connectActivityWatch(db, parsed.data, createAdapter);
    } catch (error) {
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

  app.post('/activity/sync', async (_req, reply) => {
    try {
      const service = createAdapter ? undefined : getActivitySyncService(db);
      const status = service ? await service.sync() : await refreshActivityWatchHealth(db, createAdapter);
      return { status, sync: service ? 'complete' as const : 'health_check_only' as const };
    } catch (error) {
      const message = errorMessage(error);
      return reply.code(message.includes('off') || message.includes('not configured') ? 409 : 502).send({ error: message });
    }
  });

  app.get<{ Params: { id: string } }>('/blocks/:id/activity', async (req, reply) => {
    const summary = getBlockActivitySummary(db, req.params.id);
    if (!summary) return reply.code(404).send({ error: 'No activity evidence is available for this block.' });
    return summary;
  });

  app.post<{ Params: { id: string }; Body: unknown }>('/blocks/:id/activity/correction', async (req, reply) => {
    const parsed = ActivityCorrectionInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid correction.' });
    const summary = correctBlockActivitySummary(db, req.params.id, parsed.data);
    if (!summary) return reply.code(404).send({ error: 'No activity evidence is available for this block.' });
    return summary;
  });

  app.get<{ Querystring: { from?: string; to?: string } }>('/activity/analytics', async (req, reply) => {
    const { from, to } = req.query;
    if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from >= to) {
      return reply.code(400).send({ error: 'Valid from and to UTC ISO timestamps are required.' });
    }
    return getActivityAnalytics(db, from, to);
  });

  app.get<{ Querystring: { from?: string; to?: string } }>('/activity/personal-analytics', async (req, reply) => {
    const { from, to } = req.query;
    if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from >= to) {
      return reply.code(400).send({ error: 'Valid from and to UTC ISO timestamps are required.' });
    }
    return getActivityPersonalAnalytics(db, from, to);
  });

  app.get('/activity/recommendations', async () => listActivityRecommendations(db));

  app.post<{ Body: unknown }>('/activity/ai/preview', async (req, reply) => {
    const parsed = ActivityAiPreviewInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid activity AI preview.' });
    return createActivityAiPreview(db, parsed.data);
  });

  app.post<{ Body: unknown }>('/activity/ai/analyze', async (req, reply) => {
    const parsed = ActivityAiAnalyzeInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid activity AI approval.' });
    const settings = getSettings(db);
    if (!settings.aiEnabled) return reply.code(403).send({ error: 'AI is disabled in settings.' });
    try {
      return await analyzeActivityAiPreview(db, parsed.data, createModelGateway(db), settings.aiModel);
    } catch (error) {
      if (error instanceof ActivityAiPreviewError) {
        const status = error.code === 'ai_not_configured' ? 503 : error.code === 'not_found' ? 404 : 409;
        return reply.code(status).send({ error: error.message });
      }
      throw error;
    }
  });

  for (const [suffix, status] of [['accept', 'accepted'], ['dismiss', 'dismissed']] as const) {
    app.post<{ Params: { id: string } }>(`/activity/recommendations/:id/${suffix}`, async (req, reply) => {
      const recommendation = updateActivityRecommendation(db, req.params.id, status);
      if (!recommendation) return reply.code(404).send({ error: 'Active recommendation not found.' });
      return recommendation;
    });
  }
}
