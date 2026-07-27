import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { ConnectorAccount, ConnectorProvider } from '@timeblock/shared';
import type { DB } from '../db/client.js';
import { connectorAccounts, connectorItems, knowledgeRecords, memoryClaims, memoryEvidence } from '../db/schema.js';
import { nowUtcIso } from '../config.js';
import { evidenceByIds, extractHeuristicMemoryCandidates, upsertKnowledgeRecord } from './foundation.js';

export interface ConnectorSyncItem {
  providerItemId: string;
  sourceLabel: string;
  subject: string;
  participants: string[];
  summary: string;
  evidenceExcerpt: string;
  contentHash: string;
  deepLink: string | null;
  occurredAt: string | null;
  deleted: boolean;
}

export interface ConnectorAdapter {
  provider: ConnectorProvider;
  authenticationUrl(account: ConnectorAccount): Promise<string | null>;
  sync(account: ConnectorAccount, cursor: string | null): Promise<{ items: ConnectorSyncItem[]; nextCursor: string | null }>;
  createDraft(account: ConnectorAccount, payload: Record<string, unknown>): Promise<{ providerItemId: string; deepLink: string | null }>;
  sendApproved(account: ConnectorAccount, providerItemId: string): Promise<void>;
  revoke(account: ConnectorAccount): Promise<void>;
}

class UnconfiguredConnectorAdapter implements ConnectorAdapter {
  constructor(public readonly provider: ConnectorProvider) {}

  async authenticationUrl(): Promise<string | null> {
    return null;
  }

  async sync(): Promise<{ items: ConnectorSyncItem[]; nextCursor: string | null }> {
    throw new Error(`${this.provider} connector credentials are not configured`);
  }

  async createDraft(): Promise<{ providerItemId: string; deepLink: string | null }> {
    throw new Error(`${this.provider} connector credentials are not configured`);
  }

  async sendApproved(): Promise<void> {
    throw new Error(`${this.provider} connector credentials are not configured`);
  }

  async revoke(): Promise<void> {
    return;
  }
}

export const connectorRegistry: Record<ConnectorProvider, ConnectorAdapter> = {
  gmail: new UnconfiguredConnectorAdapter('gmail'),
  outlook: new UnconfiguredConnectorAdapter('outlook'),
  slack: new UnconfiguredConnectorAdapter('slack'),
  teams: new UnconfiguredConnectorAdapter('teams'),
};

function array(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function connectorAccountToDto(row: typeof connectorAccounts.$inferSelect): ConnectorAccount {
  return {
    id: row.id,
    provider: row.provider as ConnectorProvider,
    accountLabel: row.accountLabel,
    status: row.status as ConnectorAccount['status'],
    selectedScopes: array(row.selectedScopes),
    selectedSources: array(row.selectedSources),
    aiProcessingEnabled: !!row.aiProcessingEnabled,
    lastCursor: row.lastCursor,
    lastSyncedAt: row.lastSyncedAtUtc,
    lastError: row.lastError,
    createdAt: row.createdAtUtc,
    updatedAt: row.updatedAtUtc,
  };
}

export function listConnectorAccounts(db: DB): ConnectorAccount[] {
  return db.select().from(connectorAccounts).all().map(connectorAccountToDto);
}

export function configureConnectorAccount(
  db: DB,
  provider: ConnectorProvider,
  input: { accountLabel: string; selectedScopes: string[]; selectedSources: string[]; aiProcessingEnabled: boolean },
): ConnectorAccount {
  const now = nowUtcIso();
  const existing = db
    .select()
    .from(connectorAccounts)
    .where(and(eq(connectorAccounts.provider, provider), eq(connectorAccounts.accountLabel, input.accountLabel)))
    .get();
  const id = existing?.id ?? randomUUID();
  db.insert(connectorAccounts)
    .values({
      id,
      provider,
      accountLabel: input.accountLabel,
      status: existing?.credentialRef ? 'connected' : 'disconnected',
      selectedScopes: JSON.stringify(input.selectedScopes),
      selectedSources: JSON.stringify(input.selectedSources),
      aiProcessingEnabled: input.aiProcessingEnabled ? 1 : 0,
      credentialRef: existing?.credentialRef ?? null,
      createdAtUtc: existing?.createdAtUtc ?? now,
      updatedAtUtc: now,
    })
    .onConflictDoUpdate({
      target: [connectorAccounts.provider, connectorAccounts.accountLabel],
      set: {
        selectedScopes: JSON.stringify(input.selectedScopes),
        selectedSources: JSON.stringify(input.selectedSources),
        aiProcessingEnabled: input.aiProcessingEnabled ? 1 : 0,
        updatedAtUtc: now,
      },
    })
    .run();
  return connectorAccountToDto(db.select().from(connectorAccounts).where(eq(connectorAccounts.id, id)).get()!);
}

export async function disconnectConnector(db: DB, id: string): Promise<ConnectorAccount | null> {
  const row = db.select().from(connectorAccounts).where(eq(connectorAccounts.id, id)).get();
  if (!row) return null;
  await connectorRegistry[row.provider as ConnectorProvider].revoke(connectorAccountToDto(row));
  db.update(connectorAccounts)
    .set({ status: 'disconnected', credentialRef: null, lastCursor: null, updatedAtUtc: nowUtcIso() })
    .where(eq(connectorAccounts.id, id))
    .run();
  return connectorAccountToDto(db.select().from(connectorAccounts).where(eq(connectorAccounts.id, id)).get()!);
}

export function deleteImportedConnectorKnowledge(db: DB, accountId: string): number {
  const items = db.select().from(connectorItems).where(eq(connectorItems.accountId, accountId)).all();
  const recordIds = items.map((item) => `communication:${accountId}:${item.providerItemId}`);
  if (!recordIds.length) return 0;
  const affectedMemoryIds = db
    .select({ memoryId: memoryEvidence.memoryId })
    .from(memoryEvidence)
    .where(inArray(memoryEvidence.knowledgeRecordId, recordIds))
    .all()
    .map((row) => row.memoryId);
  db.delete(memoryEvidence).where(inArray(memoryEvidence.knowledgeRecordId, recordIds)).run();
  db.delete(knowledgeRecords).where(inArray(knowledgeRecords.id, recordIds)).run();
  db.delete(connectorItems).where(eq(connectorItems.accountId, accountId)).run();
  for (const memoryId of [...new Set(affectedMemoryIds)]) {
    const remaining = db.select().from(memoryEvidence).where(eq(memoryEvidence.memoryId, memoryId)).get();
    if (!remaining) {
      db.update(memoryClaims)
        .set({ status: 'forgotten', validToUtc: nowUtcIso(), updatedAtUtc: nowUtcIso() })
        .where(eq(memoryClaims.id, memoryId))
        .run();
    }
  }
  return items.length;
}

export async function syncConnectorAccount(db: DB, id: string): Promise<ConnectorAccount | null> {
  const row = db.select().from(connectorAccounts).where(eq(connectorAccounts.id, id)).get();
  if (!row) return null;
  const dto = connectorAccountToDto(row);
  const adapter = connectorRegistry[dto.provider];
  db.update(connectorAccounts).set({ status: 'syncing', lastError: null, updatedAtUtc: nowUtcIso() }).where(eq(connectorAccounts.id, id)).run();
  try {
    const result = await adapter.sync(dto, dto.lastCursor);
    // Provider implementations intentionally return summaries + bounded evidence only.
    const now = nowUtcIso();
    for (const item of result.items) {
      db.insert(connectorItems)
        .values({
          id: `${id}:${item.providerItemId}`,
          accountId: id,
          providerItemId: item.providerItemId,
          sourceLabel: item.sourceLabel,
          subject: item.subject,
          participants: JSON.stringify(item.participants),
          summary: item.summary,
          evidenceExcerpt: item.evidenceExcerpt.slice(0, 2_000),
          contentHash: item.contentHash,
          deepLink: item.deepLink,
          occurredAtUtc: item.occurredAt,
          deletedAtUtc: item.deleted ? now : null,
          createdAtUtc: now,
          updatedAtUtc: now,
        })
        .onConflictDoUpdate({
          target: [connectorItems.accountId, connectorItems.providerItemId],
          set: {
            sourceLabel: item.sourceLabel,
            subject: item.subject,
            participants: JSON.stringify(item.participants),
            summary: item.summary,
            evidenceExcerpt: item.evidenceExcerpt.slice(0, 2_000),
            contentHash: item.contentHash,
            deepLink: item.deepLink,
            occurredAtUtc: item.occurredAt,
            deletedAtUtc: item.deleted ? now : null,
            updatedAtUtc: now,
          },
        })
        .run();
      const knowledgeId = `communication:${id}:${item.providerItemId}`;
      if (item.deleted) {
        db.update(knowledgeRecords).set({ deletedAtUtc: now, updatedAtUtc: now }).where(eq(knowledgeRecords.id, knowledgeId)).run();
      } else if (dto.aiProcessingEnabled) {
        upsertKnowledgeRecord(db, {
          sourceType: 'communication',
          sourceId: `${id}:${item.providerItemId}`,
          sourceVersion: item.contentHash,
          title: item.subject || item.sourceLabel,
          excerpt: [item.summary, item.evidenceExcerpt].filter(Boolean).join('\n'),
          occurredAt: item.occurredAt,
          contentHash: item.contentHash,
          sensitivity: 'sensitive',
        });
        const source = evidenceByIds(db, [knowledgeId])[0];
        if (source) extractHeuristicMemoryCandidates(db, source);
      }
    }
    db.update(connectorAccounts)
      .set({ status: 'connected', lastCursor: result.nextCursor, lastSyncedAtUtc: now, updatedAtUtc: now })
      .where(eq(connectorAccounts.id, id))
      .run();
  } catch (error) {
    db.update(connectorAccounts)
      .set({ status: 'error', lastError: error instanceof Error ? error.message : String(error), updatedAtUtc: nowUtcIso() })
      .where(eq(connectorAccounts.id, id))
      .run();
  }
  return connectorAccountToDto(db.select().from(connectorAccounts).where(eq(connectorAccounts.id, id)).get()!);
}
