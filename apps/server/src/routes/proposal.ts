import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import type { ProposalDTO, ProposalRefineInput } from '@timeblock/shared';
import type { DB } from '../db/client.js';
import type { SyncManager } from '../sync/manager.js';
import { nowUtcIso } from '../config.js';
import { applyProposal, createProposal, discardProposal, getCurrentProposal, refineProposal } from '../sync/proposals.js';

/**
 * Propose -> approve scheduling (Phase 1). Nothing here writes to Google/DB
 * blocks except /apply, and /apply always re-validates against fresh state
 * right before writing (see sync/proposals.ts applyProposal).
 */
export function registerProposalRoutes(app: FastifyInstance, db: DB, manager: SyncManager) {
  app.post<{ Body: { scopeDate?: string } | undefined }>('/plan/proposal', async (req, reply) => {
    // Pull fresh Google state first so the draft reflects the real calendar, not a stale cache.
    await manager.runCycle('proposal-prep', { forceGoogle: true });
    const nowIso = nowUtcIso();
    const outcome = await manager.runExclusive(async () => {
      const { settings, externalBusy } = await manager.proposalContext(nowIso);
      const scopeDate = req.body?.scopeDate ?? DateTime.fromISO(nowIso, { zone: 'utc' }).setZone(settings.timezone).toISODate()!;
      return createProposal(db, settings, externalBusy, nowIso, scopeDate);
    });
    if (outcome.busy) return reply.code(409).send({ error: 'sync busy, try again' });
    return outcome.result;
  });

  app.get('/plan/proposal', async (): Promise<ProposalDTO | null> => {
    const nowIso = nowUtcIso();
    const { settings, externalBusy } = await manager.proposalContext(nowIso);
    return getCurrentProposal(db, settings, externalBusy, nowIso);
  });

  app.post<{ Params: { id: string } }>('/plan/proposal/:id/apply', async (req, reply) => {
    const nowIso = nowUtcIso();
    const outcome = await manager.runExclusive(async () => {
      const { settings, gcalClient, externalBusy } = await manager.proposalContext(nowIso);
      if (!gcalClient || !settings.appCalendarId) {
        return { ok: false as const, reason: 'no_calendar' as const };
      }
      return applyProposal(db, gcalClient, settings, externalBusy, nowIso, req.params.id);
    });
    if (outcome.busy) return reply.code(409).send({ error: 'sync busy, try again' });

    const result = outcome.result;
    if (!result.ok) {
      if (result.reason === 'conflict') return reply.code(409).send({ error: 'conflict', conflicts: result.conflicts });
      return reply.code(result.reason === 'not_found' ? 404 : 400).send({ error: result.reason });
    }
    return result.summary;
  });

  app.post<{ Params: { id: string }; Body: ProposalRefineInput | undefined }>('/plan/proposal/:id/refine', async (req, reply) => {
    const nowIso = nowUtcIso();
    const outcome = await manager.runExclusive(async () => {
      const { settings, externalBusy } = await manager.proposalContext(nowIso);
      return refineProposal(db, settings, externalBusy, nowIso, req.params.id, req.body ?? {});
    });
    if (outcome.busy) return reply.code(409).send({ error: 'sync busy, try again' });

    const result = outcome.result;
    if (!result.ok) return reply.code(result.reason === 'not_found' ? 404 : 400).send({ error: result.reason });
    return result.proposal;
  });

  app.delete<{ Params: { id: string } }>('/plan/proposal/:id', async (req, reply) => {
    const ok = discardProposal(db, req.params.id);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });
}
