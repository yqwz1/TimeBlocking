import { createHash, randomUUID } from 'node:crypto';
import { eq, lte } from 'drizzle-orm';
import {
  aiConfigured,
  embedContentWithUsage,
  generateAudioJsonWithUsage,
  generateJsonWithUsage,
  generateTextWithUsage,
  generateVisionTextWithUsage,
  type JsonSchema,
  type ProviderUsage,
} from '../ai/client.js';
import { nowUtcIso } from '../config.js';
import type { DB } from '../db/client.js';
import { aiEmbeddingCache, aiResponseCache, aiRuns } from '../db/schema.js';

export interface ModelGatewayRequest<T> {
  task: string;
  promptVersion: string;
  model: string;
  prompt: string;
  schema: JsonSchema;
  validate(value: unknown): T;
  retrievedRecordIds?: string[];
  cacheTtlMs?: number;
  retries?: number;
}

export type AiRouteTier = 'deterministic' | 'local' | 'cheap-cloud' | 'quality-cloud';

export interface AiTaskPolicy {
  task: string;
  inputBudget: number;
  outputBudget: number;
  defaultTier: AiRouteTier;
  cacheTtlMs?: number;
  allowEscalation?: boolean;
  privacy?: 'local-only' | 'cloud-allowed';
}

export interface RoutingDecision {
  tier: AiRouteTier;
  model: string;
  escalated: boolean;
  escalationReason: string | null;
}

export interface AiUsage extends ProviderUsage {
  estimated: boolean;
}

export interface AiResult<T> {
  value: T;
  routing: RoutingDecision;
  usage: AiUsage;
  cacheStatus: 'miss' | 'hit';
}

export const AI_TASK_POLICIES: Record<string, AiTaskPolicy> = {
  extraction: { task: 'extraction', inputBudget: 2_000, outputBudget: 250, defaultTier: 'local', cacheTtlMs: 30 * 24 * 60 * 60_000 },
  assistant_chat: { task: 'assistant_chat', inputBudget: 6_000, outputBudget: 700, defaultTier: 'cheap-cloud', allowEscalation: true },
  vault_synthesis: { task: 'vault_synthesis', inputBudget: 5_000, outputBudget: 800, defaultTier: 'cheap-cloud', allowEscalation: true },
  draft: { task: 'draft', inputBudget: 5_000, outputBudget: 1_000, defaultTier: 'cheap-cloud', allowEscalation: true },
  complex_answer: { task: 'complex_answer', inputBudget: 10_000, outputBudget: 1_200, defaultTier: 'quality-cloud' },
  wishlist_import: { task: 'wishlist_import', inputBudget: 900, outputBudget: 120, defaultTier: 'cheap-cloud', cacheTtlMs: 30 * 24 * 60 * 60_000 },
  wishlist_advice: { task: 'wishlist_advice', inputBudget: 4_000, outputBudget: 500, defaultTier: 'cheap-cloud', cacheTtlMs: 7 * 24 * 60 * 60_000 },
};

function cacheKey(input: Pick<ModelGatewayRequest<unknown>, 'task' | 'promptVersion' | 'model' | 'prompt'>): string {
  return createHash('sha256')
    .update(JSON.stringify({ task: input.task, promptVersion: input.promptVersion, model: input.model, prompt: input.prompt }))
    .digest('hex');
}

function policyFor(request: Pick<ModelGatewayRequest<unknown>, 'task' | 'cacheTtlMs'>): AiTaskPolicy {
  const policy = AI_TASK_POLICIES[request.task] ?? AI_TASK_POLICIES.extraction;
  return { ...policy, task: request.task, cacheTtlMs: request.cacheTtlMs ?? policy.cacheTtlMs };
}

/** A conservative, provider-independent guard. Native usage is always preferred after a request. */
function trimToBudget(prompt: string, budget: number): string {
  const maxChars = budget * 4;
  return prompt.length <= maxChars ? prompt : `${prompt.slice(0, maxChars)}\n\n[Context truncated to request budget]`;
}

function toUsage(usage: ProviderUsage): AiUsage {
  return { ...usage, estimated: !usage.exact };
}

const inFlight = new Map<string, Promise<unknown>>();

export class ModelGateway {
  constructor(private readonly db: DB) {}

  configured(): boolean {
    return aiConfigured();
  }

  async generateText(request: Omit<ModelGatewayRequest<string>, 'schema' | 'validate'> & { validate?: (value: unknown) => string }): Promise<AiResult<string>> {
    return this.run(request, async (model, prompt) => {
      const result = await generateTextWithUsage(model, prompt);
      return { value: request.validate ? request.validate(result.value) : result.value, usage: result.usage, provider: result.provider, model: result.model };
    });
  }

  async generateVisionText(request: Omit<ModelGatewayRequest<string>, 'schema' | 'validate'>, image: Buffer, mimeType: string): Promise<AiResult<string>> {
    return this.run(request, async (model, prompt) => generateVisionTextWithUsage(model, prompt, image, mimeType));
  }

  async generateAudioStructured<T>(request: ModelGatewayRequest<T>, audio: Buffer, mimeType: string): Promise<AiResult<T>> {
    return this.run(request, async (model, prompt) => {
      const result = await generateAudioJsonWithUsage<unknown>(model, prompt, audio, mimeType, request.schema);
      return { ...result, value: request.validate(result.value) };
    });
  }

  async embed(model: string, texts: string[], dimensions: number, task = 'embedding'): Promise<AiResult<number[][]>> {
    const key = createHash('sha256').update(JSON.stringify({ task, model, dimensions, texts })).digest('hex');
    const execute = async () => {
      const result = await embedContentWithUsage(model, texts, dimensions);
      return { value: result.value, routing: { tier: 'cheap-cloud' as const, model: result.model, escalated: false, escalationReason: null }, usage: toUsage(result.usage), cacheStatus: 'miss' as const };
    };
    const shared = inFlight.get(key) ?? execute();
    if (!inFlight.has(key)) inFlight.set(key, shared);
    try {
      return (await shared) as AiResult<number[][]>;
    } finally {
      if (inFlight.get(key) === shared) inFlight.delete(key);
    }
  }

  /** Reuses vectors across every index. The cache stores only a hash and vector, never the source text. */
  async embedCached(model: string, texts: string[], dimensions: number, task = 'embedding'): Promise<AiResult<number[][]>> {
    const cacheModel = model || 'auto';
    const hashes = texts.map((text) => createHash('sha256').update(text).digest('hex'));
    const vectors: Array<number[] | undefined> = new Array(texts.length);
    const missing: number[] = [];
    const cacheRows = this.db.select().from(aiEmbeddingCache).where(eq(aiEmbeddingCache.model, cacheModel)).all();
    hashes.forEach((contentHash, index) => {
      const cached = cacheRows.find((row) => row.dimensions === dimensions && row.contentHash === contentHash);
      if (!cached) missing.push(index);
      else {
        try { vectors[index] = JSON.parse(cached.vector) as number[]; } catch { missing.push(index); }
      }
    });
    if (!missing.length) {
      return { value: vectors.map((vector) => vector ?? []), routing: { tier: 'cheap-cloud', model: cacheModel, escalated: false, escalationReason: null }, usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, billableTokens: 0, estimatedUsd: 0, exact: true, estimated: false }, cacheStatus: 'hit' };
    }
    const fresh = await this.embed(model, missing.map((index) => texts[index]!), dimensions, task);
    const now = nowUtcIso();
    missing.forEach((originalIndex, freshIndex) => {
      const vector = fresh.value[freshIndex] ?? [];
      vectors[originalIndex] = vector;
      if (!vector.length) return;
      this.db.insert(aiEmbeddingCache).values({ model: cacheModel, dimensions, contentHash: hashes[originalIndex]!, vector: JSON.stringify(vector), createdAtUtc: now }).onConflictDoNothing().run();
    });
    return { ...fresh, value: vectors.map((vector) => vector ?? []) };
  }

  async generateStructured<T>(request: ModelGatewayRequest<T>): Promise<T> {
    return (await this.generateStructuredResult(request)).value;
  }

  async generateStructuredResult<T>(request: ModelGatewayRequest<T>): Promise<AiResult<T>> {
    return this.run(request, async (model, prompt) => {
      const result = await generateJsonWithUsage<unknown>(model, prompt, request.schema, policyFor(request).outputBudget);
      return { value: request.validate(result.value), usage: result.usage, provider: result.provider, model: result.model };
    });
  }

  private async run<T>(request: Omit<ModelGatewayRequest<T>, 'schema' | 'validate'> & Partial<Pick<ModelGatewayRequest<T>, 'schema' | 'validate'>>, invoke: (model: string, prompt: string) => Promise<{ value: T; usage: ProviderUsage; provider: string; model: string }>): Promise<AiResult<T>> {
    if (!aiConfigured()) throw new Error('AI is not configured');
    const key = cacheKey(request);
    const policy = policyFor(request);
    const prompt = trimToBudget(request.prompt, policy.inputBudget);
    const now = nowUtcIso();
    this.db.delete(aiResponseCache).where(lte(aiResponseCache.expiresAtUtc, now)).run();
    if (policy.cacheTtlMs) {
      const cached = this.db.select().from(aiResponseCache).where(eq(aiResponseCache.key, key)).get();
      if (cached && cached.expiresAtUtc > now) {
        const value = request.validate ? request.validate(JSON.parse(cached.value)) : (JSON.parse(cached.value) as T);
        this.db.insert(aiRuns).values({
          id: randomUUID(), task: request.task, provider: 'local-cache', model: request.model, promptVersion: request.promptVersion,
          cacheKey: key, status: 'completed', latencyMs: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, billableTokens: 0,
          cachedTokens: 0, estimatedUsd: 0, routeTier: policy.defaultTier, cacheStatus: 'hit', retrievedRecordIds: JSON.stringify(request.retrievedRecordIds ?? []), createdAtUtc: now,
        }).run();
        return { value, routing: { tier: policy.defaultTier, model: request.model, escalated: false, escalationReason: null }, usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, billableTokens: 0, estimatedUsd: 0, exact: true, estimated: false }, cacheStatus: 'hit' };
      }
    }

    const id = randomUUID();
    const started = Date.now();
    let lastError: unknown;
    const retries = Math.max(0, request.retries ?? 2);
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await invoke(request.model, prompt);
        const validated = response.value;
        const encoded = JSON.stringify(validated);
        if (policy.cacheTtlMs) {
          this.db
            .insert(aiResponseCache)
            .values({
              key,
              value: encoded,
              expiresAtUtc: new Date(Date.now() + policy.cacheTtlMs).toISOString(),
              createdAtUtc: now,
            })
            .onConflictDoUpdate({
              target: aiResponseCache.key,
              set: { value: encoded, expiresAtUtc: new Date(Date.now() + policy.cacheTtlMs).toISOString(), createdAtUtc: now },
            })
            .run();
        }
        this.db
          .insert(aiRuns)
          .values({
            id,
            task: request.task,
            provider: response.provider,
            model: response.model,
            promptVersion: request.promptVersion,
            cacheKey: policy.cacheTtlMs ? key : null,
            status: 'completed',
            latencyMs: Date.now() - started,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            routeTier: policy.defaultTier,
            billableTokens: response.usage.billableTokens,
            cachedTokens: response.usage.cachedTokens,
            reasoningTokens: response.usage.reasoningTokens,
            estimatedUsd: response.usage.estimatedUsd,
            cacheStatus: 'miss',
            retrievedRecordIds: JSON.stringify(request.retrievedRecordIds ?? []),
            createdAtUtc: now,
          })
          .run();
        return { value: validated, routing: { tier: policy.defaultTier, model: response.model, escalated: false, escalationReason: null }, usage: toUsage(response.usage), cacheStatus: 'miss' };
      } catch (error) {
        lastError = error;
      }
    }
    this.db
      .insert(aiRuns)
      .values({
        id,
        task: request.task,
        provider: 'unknown',
        model: request.model,
        promptVersion: request.promptVersion,
        cacheKey: policy.cacheTtlMs ? key : null,
        status: 'failed',
        latencyMs: Date.now() - started,
        inputTokens: 0,
        outputTokens: 0,
        routeTier: policy.defaultTier,
        billableTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        estimatedUsd: null,
        cacheStatus: 'miss',
        retrievedRecordIds: JSON.stringify(request.retrievedRecordIds ?? []),
        error: lastError instanceof Error ? lastError.message.slice(0, 2_000) : String(lastError).slice(0, 2_000),
        createdAtUtc: now,
      })
      .run();
    throw lastError;
  }
}
