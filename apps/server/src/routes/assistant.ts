import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  AssistantChatSchema,
  MemoryClaimInputSchema,
  MemoryClaimPatchSchema,
  type Commitment,
  type ConnectorProvider,
  type Decision,
  type MemoryStatus,
} from '@timeblock/shared';
import type { DB } from '../db/client.js';
import type { SyncManager } from '../sync/manager.js';
import {
  assistantFeedback,
  actionProposals,
  aiRuns,
  commitments,
  decisions,
  events,
  knowledgeEntities,
  knowledgeRelations,
  memoryClaims,
  proactiveInsights,
} from '../db/schema.js';
import { getSettings } from '../settings.js';
import { nowUtcIso } from '../config.js';
import {
  backfillKnowledgeRecords,
  createMemory,
  ensureProfileMemory,
  evidenceByIds,
  forgetMemory,
  knowledgeRecordBySource,
  listMemories,
  promoteConceptCandidates,
  recordDomainEvent,
  updateMemory,
} from '../assistant/foundation.js';
import {
  createAssistantThread,
  getAssistantThread,
  listAssistantThreads,
  runAssistantChat,
} from '../assistant/runtime.js';
import {
  approveAndExecuteActionProposal,
  listActionProposals,
  rejectActionProposal,
} from '../assistant/actions.js';
import {
  configureConnectorAccount,
  deleteImportedConnectorKnowledge,
  disconnectConnector,
  listConnectorAccounts,
  syncConnectorAccount,
} from '../assistant/connectors.js';
import {
  buildDailyBriefing,
  buildWeeklyBriefing,
  listProactiveInsights,
  refreshProactiveInsights,
} from '../assistant/briefings.js';
import { DurableJobRunner, enqueueDurableJob, listDurableJobs } from '../assistant/jobs.js';
import { buildKnowledgeEmbeddingVersion, listKnowledgeIndexes } from '../assistant/indexing.js';
import { buildContextPack } from '../assistant/retrieval.js';
import { getAiUsageDashboard } from '../ai/usageDashboard.js';

function jsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function commitmentToDto(db: DB, row: typeof commitments.$inferSelect): Commitment {
  return {
    id: row.id,
    direction: row.direction as Commitment['direction'],
    title: row.title,
    details: row.details,
    personEntityId: row.personEntityId,
    dueAt: row.dueAtUtc,
    status: row.status as Commitment['status'],
    evidence: evidenceByIds(db, jsonArray(row.evidenceIds)),
    createdAt: row.createdAtUtc,
    updatedAt: row.updatedAtUtc,
  };
}

function decisionToDto(db: DB, row: typeof decisions.$inferSelect): Decision {
  return {
    id: row.id,
    title: row.title,
    decision: row.decision,
    rationale: row.rationale,
    alternatives: jsonArray(row.alternatives),
    participantEntityIds: jsonArray(row.participantEntityIds),
    outcome: row.outcome,
    decidedAt: row.decidedAtUtc,
    evidence: evidenceByIds(db, jsonArray(row.evidenceIds)),
    createdAt: row.createdAtUtc,
    updatedAt: row.updatedAtUtc,
  };
}

const ConnectorConfigSchema = z.object({
  accountLabel: z.string().min(1).max(200),
  selectedScopes: z.array(z.string()).max(50).default([]),
  selectedSources: z.array(z.string()).max(500).default([]),
  aiProcessingEnabled: z.boolean().default(false),
});

const CommitmentSchema = z.object({
  direction: z.enum(['by_me', 'to_me']),
  title: z.string().min(1).max(500),
  details: z.string().max(10_000).default(''),
  personEntityId: z.string().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  status: z.enum(['open', 'waiting', 'done', 'cancelled']).default('open'),
  evidenceIds: z.array(z.string()).max(30).default([]),
});

const DecisionSchema = z.object({
  title: z.string().min(1).max(500),
  decision: z.string().min(1).max(10_000),
  rationale: z.string().max(10_000).default(''),
  alternatives: z.array(z.string()).max(30).default([]),
  participantEntityIds: z.array(z.string()).max(30).default([]),
  outcome: z.string().max(10_000).nullable().optional(),
  decidedAt: z.string().datetime().optional(),
  evidenceIds: z.array(z.string()).max(30).default([]),
});

const ONBOARDING_QUESTIONS = [
  { id: 'roles', memoryClass: 'identity_fact', prompt: 'What roles and responsibilities matter most in your life right now?' },
  { id: 'values', memoryClass: 'value', prompt: 'Which values should guide recommendations when priorities conflict?' },
  { id: 'goals', memoryClass: 'active_goal', prompt: 'What are your three most important current goals?' },
  { id: 'communication', memoryClass: 'preference', prompt: 'How should the assistant communicate with you: tone, detail, and language?' },
  { id: 'energy', memoryClass: 'routine', prompt: 'When do you have the most and least energy, and what interrupts your focus?' },
  { id: 'constraints', memoryClass: 'constraint', prompt: 'What constraints or non-negotiables should plans respect?' },
] as const;

export function registerAssistantRoutes(app: FastifyInstance, db: DB, manager: SyncManager) {
  const runner = new DurableJobRunner(db, {
    'assistant.knowledge-backfill': () => {
      backfillKnowledgeRecords(db);
      promoteConceptCandidates(db);
    },
    'assistant.profile-import': () => {
      ensureProfileMemory(db, getSettings(db).aiAboutMe);
    },
    'assistant.insights-refresh': () => {
      refreshProactiveInsights(db);
    },
    'assistant.embedding-rebuild': async (_payload, context) => {
      const settings = getSettings(db);
      await buildKnowledgeEmbeddingVersion(db, settings.aiEmbeddingModel, context.saveCheckpoint);
    },
  });
  enqueueDurableJob(db, 'assistant.profile-import', {}, { dedupeKey: 'assistant.profile-import:v1' });
  enqueueDurableJob(db, 'assistant.knowledge-backfill', {}, { dedupeKey: `assistant.knowledge-backfill:${nowUtcIso().slice(0, 10)}` });
  enqueueDurableJob(db, 'assistant.insights-refresh', {}, { dedupeKey: `assistant.insights-refresh:${nowUtcIso().slice(0, 13)}` });
  runner.start();

  app.get('/assistant/status', async () => {
    const settings = getSettings(db);
    return {
      enabled: settings.assistantEnabled,
      memoryEnabled: settings.assistantMemoryEnabled,
      actionsEnabled: settings.assistantActionsEnabled,
      proactiveEnabled: settings.assistantProactiveEnabled,
      connectorsEnabled: settings.assistantConnectorsEnabled,
      fallback: settings.assistantEnabled ? null : '/notes/chat',
    };
  });

  app.get('/assistant/usage', async () => getAiUsageDashboard(db));

  app.get('/assistant/threads', async () => listAssistantThreads(db));
  app.post<{ Body: { title?: string } }>('/assistant/threads', async (req) => createAssistantThread(db, req.body?.title));
  app.get<{ Params: { id: string } }>('/assistant/threads/:id', async (req, reply) => {
    const thread = getAssistantThread(db, req.params.id);
    return thread ?? reply.code(404).send({ error: 'thread not found' });
  });
  app.post<{ Body: unknown }>('/assistant/chat', async (req, reply) => {
    const parsed = AssistantChatSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return await runAssistantChat(db, parsed.data);
    } catch (error) {
      return reply.code(503).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.post<{ Params: { id: string }; Body: { rating?: string; detail?: string } }>('/assistant/messages/:id/feedback', async (req, reply) => {
    if (!['helpful', 'not_helpful'].includes(req.body?.rating ?? '')) return reply.code(400).send({ error: 'rating must be helpful or not_helpful' });
    const now = nowUtcIso();
    db.insert(assistantFeedback)
      .values({ id: randomUUID(), messageId: req.params.id, rating: req.body.rating!, detail: req.body.detail ?? '', createdAtUtc: now })
      .onConflictDoUpdate({
        target: assistantFeedback.messageId,
        set: { rating: req.body.rating!, detail: req.body.detail ?? '', createdAtUtc: now },
      })
      .run();
    return { ok: true };
  });
  app.post<{ Params: { id: string }; Body: { evidenceId?: string } }>('/assistant/messages/:id/citation-open', async (req, reply) => {
    if (!req.body?.evidenceId) return reply.code(400).send({ error: 'evidenceId is required' });
    recordDomainEvent(db, 'citation.opened', 'assistant_message', req.params.id, { evidenceId: req.body.evidenceId });
    return { ok: true };
  });

  app.get<{ Querystring: { status?: MemoryStatus } }>('/assistant/memories', async (req) => listMemories(db, req.query.status));
  app.post<{ Body: unknown }>('/assistant/memories', async (req, reply) => {
    const parsed = MemoryClaimInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return createMemory(db, parsed.data, { status: 'confirmed', confidence: 1 });
  });
  app.patch<{ Params: { id: string }; Body: unknown }>('/assistant/memories/:id', async (req, reply) => {
    const parsed = MemoryClaimPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const updated = updateMemory(db, req.params.id, parsed.data);
    return updated ?? reply.code(404).send({ error: 'memory not found' });
  });
  app.post<{ Params: { id: string } }>('/assistant/memories/:id/forget', async (req, reply) => {
    return forgetMemory(db, req.params.id) ? { ok: true } : reply.code(404).send({ error: 'memory not found' });
  });
  app.get<{ Querystring: { sourceType?: string; sourceId?: string } }>('/assistant/source', async (req, reply) => {
    if (!req.query.sourceType || !req.query.sourceId) return reply.code(400).send({ error: 'sourceType and sourceId are required' });
    const record = knowledgeRecordBySource(db, req.query.sourceType as Parameters<typeof knowledgeRecordBySource>[1], req.query.sourceId);
    return record ?? reply.code(404).send({ error: 'source not found or deleted' });
  });

  app.get('/assistant/entities', async () =>
    db
      .select()
      .from(knowledgeEntities)
      .all()
      .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        canonicalName: row.canonicalName,
        aliases: jsonArray(row.aliases),
        description: row.description,
        status: row.status,
        sensitivity: row.sensitivity,
        createdAt: row.createdAtUtc,
        updatedAt: row.updatedAtUtc,
      })),
  );
  app.patch<{ Params: { id: string }; Body: { status?: string; canonicalName?: string; aliases?: string[]; description?: string } }>(
    '/assistant/entities/:id',
    async (req, reply) => {
      const current = db.select().from(knowledgeEntities).where(eq(knowledgeEntities.id, req.params.id)).get();
      if (!current) return reply.code(404).send({ error: 'entity not found' });
      if (req.body.status && !['candidate', 'confirmed', 'rejected', 'merged'].includes(req.body.status)) {
        return reply.code(400).send({ error: 'invalid entity status' });
      }
      db.update(knowledgeEntities)
        .set({
          status: req.body.status ?? current.status,
          canonicalName: req.body.canonicalName?.trim() || current.canonicalName,
          aliases: req.body.aliases ? JSON.stringify(req.body.aliases) : current.aliases,
          description: req.body.description ?? current.description,
          updatedAtUtc: nowUtcIso(),
        })
        .where(eq(knowledgeEntities.id, req.params.id))
        .run();
      return { ok: true };
    },
  );
  app.get('/assistant/relations', async () =>
    db
      .select()
      .from(knowledgeRelations)
      .all()
      .map((row) => ({ ...row, evidence: evidenceByIds(db, jsonArray(row.evidenceIds)) })),
  );

  app.get('/assistant/onboarding', async () => ({ questions: ONBOARDING_QUESTIONS }));
  app.post<{ Body: { answers?: Record<string, string> } }>('/assistant/onboarding', async (req, reply) => {
    const answers = req.body?.answers ?? {};
    const created = [];
    for (const question of ONBOARDING_QUESTIONS) {
      const answer = answers[question.id]?.trim();
      if (!answer) continue;
      created.push(
        createMemory(
          db,
          {
            memoryClass: question.memoryClass,
            claim: answer,
            sensitivity: 'normal',
            evidence: [{ sourceType: 'manual', sourceId: `onboarding:${question.id}`, title: question.prompt, excerpt: answer }],
          },
          { status: 'confirmed', confidence: 1 },
        ),
      );
    }
    if (!created.length) return reply.code(400).send({ error: 'at least one answer is required' });
    return { memories: created };
  });

  app.get<{ Querystring: { status?: string } }>('/assistant/proposals', async (req) => {
    const statuses = req.query.status?.split(',').filter(Boolean) as Parameters<typeof listActionProposals>[1];
    return listActionProposals(db, statuses);
  });
  app.post<{ Params: { id: string }; Body: { confirmPreview?: boolean } }>('/assistant/proposals/:id/approve', async (req, reply) => {
    try {
      const proposal = await approveAndExecuteActionProposal(db, manager, req.params.id, { confirmPreview: !!req.body?.confirmPreview });
      return proposal ?? reply.code(404).send({ error: 'proposal not found' });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  app.post<{ Params: { id: string } }>('/assistant/proposals/:id/reject', async (req, reply) => {
    return rejectActionProposal(db, req.params.id) ?? reply.code(404).send({ error: 'proposal not found' });
  });

  app.get('/assistant/connectors', async () => listConnectorAccounts(db));
  app.post<{ Params: { provider: ConnectorProvider }; Body: unknown }>('/assistant/connectors/:provider', async (req, reply) => {
    if (!getSettings(db).assistantConnectorsEnabled) return reply.code(403).send({ error: 'Communication connectors are disabled by feature flag' });
    if (!['gmail', 'outlook', 'slack', 'teams'].includes(req.params.provider)) return reply.code(400).send({ error: 'unsupported connector' });
    const parsed = ConnectorConfigSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    return configureConnectorAccount(db, req.params.provider, parsed.data);
  });
  app.post<{ Params: { id: string } }>('/assistant/connectors/:id/sync', async (req, reply) => {
    const account = await syncConnectorAccount(db, req.params.id);
    return account ?? reply.code(404).send({ error: 'connector not found' });
  });
  app.post<{ Params: { id: string } }>('/assistant/connectors/:id/disconnect', async (req, reply) => {
    const account = await disconnectConnector(db, req.params.id);
    return account ?? reply.code(404).send({ error: 'connector not found' });
  });
  app.delete<{ Params: { id: string } }>('/assistant/connectors/:id/knowledge', async (req) => ({ deleted: deleteImportedConnectorKnowledge(db, req.params.id) }));

  app.get('/assistant/commitments', async () =>
    db.select().from(commitments).orderBy(desc(commitments.updatedAtUtc)).all().map((row) => commitmentToDto(db, row)),
  );
  app.post<{ Body: unknown }>('/assistant/commitments', async (req, reply) => {
    const parsed = CommitmentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const now = nowUtcIso();
    const id = randomUUID();
    db.insert(commitments)
      .values({
        id,
        direction: parsed.data.direction,
        title: parsed.data.title,
        details: parsed.data.details,
        personEntityId: parsed.data.personEntityId ?? null,
        dueAtUtc: parsed.data.dueAt ?? null,
        status: parsed.data.status,
        evidenceIds: JSON.stringify(parsed.data.evidenceIds),
        createdAtUtc: now,
        updatedAtUtc: now,
      })
      .run();
    return commitmentToDto(db, db.select().from(commitments).where(eq(commitments.id, id)).get()!);
  });
  app.patch<{ Params: { id: string }; Body: unknown }>('/assistant/commitments/:id', async (req, reply) => {
    const parsed = CommitmentSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const current = db.select().from(commitments).where(eq(commitments.id, req.params.id)).get();
    if (!current) return reply.code(404).send({ error: 'commitment not found' });
    db.update(commitments)
      .set({
        ...parsed.data,
        personEntityId: parsed.data.personEntityId === undefined ? current.personEntityId : parsed.data.personEntityId,
        dueAtUtc: parsed.data.dueAt === undefined ? current.dueAtUtc : parsed.data.dueAt,
        evidenceIds: parsed.data.evidenceIds ? JSON.stringify(parsed.data.evidenceIds) : current.evidenceIds,
        updatedAtUtc: nowUtcIso(),
      })
      .where(eq(commitments.id, req.params.id))
      .run();
    return commitmentToDto(db, db.select().from(commitments).where(eq(commitments.id, req.params.id)).get()!);
  });

  app.get('/assistant/decisions', async () => db.select().from(decisions).orderBy(desc(decisions.decidedAtUtc)).all().map((row) => decisionToDto(db, row)));
  app.post<{ Body: unknown }>('/assistant/decisions', async (req, reply) => {
    const parsed = DecisionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const now = nowUtcIso();
    const id = randomUUID();
    db.insert(decisions)
      .values({
        id,
        title: parsed.data.title,
        decision: parsed.data.decision,
        rationale: parsed.data.rationale,
        alternatives: JSON.stringify(parsed.data.alternatives),
        participantEntityIds: JSON.stringify(parsed.data.participantEntityIds),
        outcome: parsed.data.outcome ?? null,
        decidedAtUtc: parsed.data.decidedAt ?? now,
        evidenceIds: JSON.stringify(parsed.data.evidenceIds),
        createdAtUtc: now,
        updatedAtUtc: now,
      })
      .run();
    return decisionToDto(db, db.select().from(decisions).where(eq(decisions.id, id)).get()!);
  });

  app.get<{ Querystring: { date?: string } }>('/assistant/briefings/daily', async (req) => buildDailyBriefing(db, req.query.date));
  app.get<{ Querystring: { weekStart?: string } }>('/assistant/briefings/weekly', async (req) => buildWeeklyBriefing(db, req.query.weekStart));
  app.get<{ Params: { eventId: string } }>('/assistant/briefings/meeting/:eventId', async (req, reply) => {
    const event = db.select().from(events).where(eq(events.id, req.params.eventId)).get();
    if (!event) return reply.code(404).send({ error: 'event not found' });
    const settings = getSettings(db);
    const context = await buildContextPack(db, `${event.title}\n${event.description}\n${event.location}`, {
      embeddingModel: settings.aiEmbeddingModel,
      maxRecords: 16,
    });
    const eventEvidence = evidenceByIds(db, [`calendar:${event.id}`]);
    return {
      event: {
        id: event.id,
        title: event.title,
        startUtc: event.startUtc,
        endUtc: event.endUtc,
        location: event.location,
        meetingUrl: event.meetingUrl,
      },
      relevantKnowledge: context.records.filter((record) => record.id !== `calendar:${event.id}`),
      confirmedMemories: context.confirmedMemories,
      candidateInferences: context.candidateMemories,
      citations: [...eventEvidence, ...context.evidence.filter((item) => item.id !== `calendar:${event.id}`)],
      generatedAt: nowUtcIso(),
    };
  });
  app.get('/assistant/insights', async () => listProactiveInsights(db));
  app.post<{ Params: { id: string }; Body: { helpful?: boolean; status?: string } }>('/assistant/insights/:id/feedback', async (req, reply) => {
    const row = db.select().from(proactiveInsights).where(eq(proactiveInsights.id, req.params.id)).get();
    if (!row) return reply.code(404).send({ error: 'insight not found' });
    db.update(proactiveInsights)
      .set({
        helpful: req.body.helpful === undefined ? row.helpful : req.body.helpful ? 1 : 0,
        status: ['seen', 'dismissed', 'acted_on'].includes(req.body.status ?? '') ? req.body.status! : row.status,
      })
      .where(eq(proactiveInsights.id, req.params.id))
      .run();
    return { ok: true };
  });

  app.get('/assistant/jobs', async () => listDurableJobs(db));
  app.post('/assistant/jobs/backfill', async () => ({
    id: enqueueDurableJob(db, 'assistant.knowledge-backfill', {}, { dedupeKey: `assistant.knowledge-backfill:manual:${randomUUID()}` }),
  }));
  app.get('/assistant/indexes', async () => listKnowledgeIndexes(db));
  app.post('/assistant/indexes/rebuild', async (req, reply) => {
    if (!getSettings(db).aiEnabled) return reply.code(403).send({ error: 'AI is disabled' });
    return { id: enqueueDurableJob(db, 'assistant.embedding-rebuild', {}, { dedupeKey: `assistant.embedding-rebuild:${randomUUID()}`, maxAttempts: 2 }) };
  });
  app.get<{ Querystring: { from?: string; to?: string; task?: string } }>('/assistant/metrics', async (req) => {
    const feedback = db.select().from(assistantFeedback).all();
    const memories = db.select().from(memoryClaims).all();
    const reviewed = memories.filter((memory) => memory.status === 'confirmed' || memory.status === 'rejected');
    const proposals = db.select().from(actionProposals).all();
    const runs = db
      .select()
      .from(aiRuns)
      .all()
      .filter((run) => (!req.query.from || run.createdAtUtc >= req.query.from) && (!req.query.to || run.createdAtUtc <= req.query.to) && (!req.query.task || run.task === req.query.task));
    const insights = db.select().from(proactiveInsights).all();
    const successfulRuns = runs.filter((run) => run.status === 'completed');
    const percentile = (values: number[], p: number): number | null => {
      if (!values.length) return null;
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? null;
    };
    const billable = successfulRuns.map((run) => run.billableTokens);
    const costs = successfulRuns.map((run) => run.estimatedUsd ?? 0);
    const baselineTokens = successfulRuns.reduce((sum, run) => sum + run.inputTokens + run.outputTokens, 0);
    return {
      helpfulAnswers: feedback.filter((item) => item.rating === 'helpful').length,
      unhelpfulAnswers: feedback.filter((item) => item.rating === 'not_helpful').length,
      memoryCandidateAcceptanceRate: reviewed.length
        ? reviewed.filter((memory) => memory.status === 'confirmed').length / reviewed.length
        : null,
      proposalAcceptanceRate: proposals.length
        ? proposals.filter((proposal) => proposal.status === 'completed' || proposal.status === 'approved').length / proposals.length
        : null,
      dismissedAlerts: insights.filter((insight) => insight.status === 'dismissed').length,
      averageAiLatencyMs: successfulRuns.length
        ? Math.round(successfulRuns.reduce((sum, run) => sum + run.latencyMs, 0) / successfulRuns.length)
        : null,
      inputTokens: runs.reduce((sum, run) => sum + run.inputTokens, 0),
      outputTokens: runs.reduce((sum, run) => sum + run.outputTokens, 0),
      billableTokens: billable.reduce((sum, value) => sum + value, 0),
      estimatedUsd: costs.reduce((sum, value) => sum + value, 0),
      p50BillableTokens: percentile(billable, 0.5),
      p95BillableTokens: percentile(billable, 0.95),
      p50CostUsd: percentile(costs, 0.5),
      p95CostUsd: percentile(costs, 0.95),
      cacheHitRate: successfulRuns.length ? successfulRuns.filter((run) => run.cacheStatus === 'hit').length / successfulRuns.length : null,
      escalationRate: successfulRuns.length ? successfulRuns.filter((run) => run.routeTier === 'quality-cloud').length / successfulRuns.length : null,
      localCloudRatio: {
        local: successfulRuns.filter((run) => run.routeTier === 'local').length,
        cloud: successfulRuns.filter((run) => run.routeTier === 'cheap-cloud' || run.routeTier === 'quality-cloud').length,
      },
      savingsVersusBaselineTokens: Math.max(0, baselineTokens - billable.reduce((sum, value) => sum + value, 0)),
    };
  });
}
