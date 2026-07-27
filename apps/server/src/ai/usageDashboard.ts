import type { DB } from '../db/client.js';
import { aiRuns } from '../db/schema.js';
import { env } from '../config.js';
import { aiConfigured, getAiProvider, resolveEmbeddingModel, resolveGenerationModel } from './client.js';

export interface AiUsageDashboard {
  configured: boolean;
  provider: 'openrouter' | 'gemini';
  generationModel: string;
  embeddingModel: string;
  local: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    billableTokens: number;
    estimatedUsd: number;
    exactUsageRate: number | null;
    calls: number;
    periodStart: string;
  };
  providerBalance: {
    totalCreditsUsd: number | null;
    usedCreditsUsd: number | null;
    remainingCreditsUsd: number | null;
    keyLimitUsd: number | null;
    keyRemainingUsd: number | null;
    keyUsageUsd: number | null;
    reset: 'daily' | 'weekly' | 'monthly' | null;
    available: boolean;
    message: string | null;
  };
}

interface OpenRouterKeyResponse {
  data?: { limit?: number | null; limit_remaining?: number | null; usage?: number; limit_reset?: 'daily' | 'weekly' | 'monthly' | null };
}

interface OpenRouterCreditsResponse {
  data?: { total_credits?: number; total_usage?: number };
}

function thisMonthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function openRouterGet<T>(path: string): Promise<T> {
  const response = await fetch(`https://openrouter.ai/api/v1${path}`, {
    headers: { Authorization: `Bearer ${env.openRouterKey}` },
  });
  if (!response.ok) throw new Error(`OpenRouter usage lookup failed (${response.status})`);
  return (await response.json()) as T;
}

/**
 * Returns only aggregated, non-sensitive usage. The OpenRouter key never reaches the browser.
 * The credit endpoint is optional because OpenRouter requires a management key for it.
 */
export async function getAiUsageDashboard(db: DB): Promise<AiUsageDashboard> {
  const periodStart = thisMonthStart();
  let localRows: Array<typeof aiRuns.$inferSelect> = [];
  try {
    localRows = db.select().from(aiRuns).all().filter((row) => row.createdAtUtc >= periodStart);
  } catch {
    // Existing installations show provider data until the telemetry migration has run.
  }
  const exactRows = localRows.filter((row) => row.provider !== 'unknown');
  const local = {
    inputTokens: localRows.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: localRows.reduce((sum, row) => sum + row.outputTokens, 0),
    reasoningTokens: localRows.reduce((sum, row) => sum + row.reasoningTokens, 0),
    cachedTokens: localRows.reduce((sum, row) => sum + row.cachedTokens, 0),
    billableTokens: localRows.reduce((sum, row) => sum + row.billableTokens, 0),
    estimatedUsd: localRows.reduce((sum, row) => sum + (row.estimatedUsd ?? 0), 0),
    exactUsageRate: localRows.length ? exactRows.length / localRows.length : null,
    calls: localRows.length,
    periodStart,
  };

  const provider = getAiProvider();
  const base: AiUsageDashboard = {
    configured: aiConfigured(),
    provider,
    generationModel: resolveGenerationModel('', provider),
    embeddingModel: resolveEmbeddingModel('', provider),
    local,
    providerBalance: {
      totalCreditsUsd: null,
      usedCreditsUsd: null,
      remainingCreditsUsd: null,
      keyLimitUsd: null,
      keyRemainingUsd: null,
      keyUsageUsd: null,
      reset: null,
      available: false,
      message: null,
    },
  };
  if (!base.configured) {
    base.providerBalance.message = 'Configure an AI provider to see its balance.';
    return base;
  }
  if (provider !== 'openrouter') {
    base.providerBalance.message = 'Gemini does not expose an account credit balance through this app. Local token totals are still shown.';
    return base;
  }

  try {
    const key = await openRouterGet<OpenRouterKeyResponse>('/key');
    base.providerBalance.keyLimitUsd = key.data?.limit ?? null;
    base.providerBalance.keyRemainingUsd = key.data?.limit_remaining ?? null;
    base.providerBalance.keyUsageUsd = key.data?.usage ?? null;
    base.providerBalance.reset = key.data?.limit_reset ?? null;
    base.providerBalance.available = key.data?.limit_remaining != null;
  } catch (error) {
    base.providerBalance.message = error instanceof Error ? error.message : 'Could not read the OpenRouter key limit.';
    return base;
  }
  try {
    const credits = await openRouterGet<OpenRouterCreditsResponse>('/credits');
    const total = credits.data?.total_credits ?? null;
    const used = credits.data?.total_usage ?? null;
    base.providerBalance.totalCreditsUsd = total;
    base.providerBalance.usedCreditsUsd = used;
    base.providerBalance.remainingCreditsUsd = total != null && used != null ? Math.max(0, total - used) : null;
    base.providerBalance.available = base.providerBalance.available || base.providerBalance.remainingCreditsUsd != null;
  } catch {
    // A regular API key is expected to be forbidden here; its key cap remains useful.
  }
  if (!base.providerBalance.available) {
    base.providerBalance.message = 'This key has no spend cap. Use an OpenRouter management key to display account credits, or create a key with a spending limit.';
  }
  return base;
}
