import { GoogleGenAI, Type, type Schema } from '@google/genai';
import { env } from '../config.js';

export type AiProvider = 'gemini' | 'openrouter';

/** Provider usage is kept separate from request content so telemetry never stores prompts. */
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  billableTokens: number;
  estimatedUsd: number | null;
  exact: boolean;
}

export interface ProviderResult<T> {
  value: T;
  usage: ProviderUsage;
  provider: AiProvider;
  model: string;
}

export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  nullable?: boolean;
  additionalProperties?: boolean;
}

interface OpenRouterMessage {
  content?: string | Array<{ type?: string; text?: string }>;
}

interface OpenRouterChatResponse {
  choices?: Array<{ message?: OpenRouterMessage }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } };
  error?: { message?: string };
}

interface OpenRouterEmbeddingResponse {
  data?: Array<{ index?: number; embedding?: number[] }>;
  usage?: { prompt_tokens?: number; total_tokens?: number; cost?: number; prompt_tokens_details?: { cached_tokens?: number } };
  error?: { message?: string };
}

function emptyUsage(): ProviderUsage {
  return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, billableTokens: 0, estimatedUsd: null, exact: false };
}

function openRouterUsage(usage: OpenRouterChatResponse['usage'] | OpenRouterEmbeddingResponse['usage'] | undefined): ProviderUsage {
  if (!usage) return emptyUsage();
  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = 'completion_tokens' in usage ? usage.completion_tokens ?? 0 : 0;
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const reasoningTokens = 'completion_tokens_details' in usage ? usage.completion_tokens_details?.reasoning_tokens ?? 0 : 0;
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedTokens,
    billableTokens: Math.max(0, (usage.total_tokens ?? inputTokens + outputTokens) - cachedTokens),
    estimatedUsd: typeof usage.cost === 'number' ? usage.cost : null,
    exact: true,
  };
}

function geminiUsage(response: { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number; totalTokenCount?: number } }): ProviderUsage {
  const meta = response.usageMetadata;
  if (!meta) return emptyUsage();
  const inputTokens = meta.promptTokenCount ?? 0;
  const outputTokens = meta.candidatesTokenCount ?? 0;
  const cachedTokens = meta.cachedContentTokenCount ?? 0;
  return {
    inputTokens,
    outputTokens,
    reasoningTokens: meta.thoughtsTokenCount ?? 0,
    cachedTokens,
    billableTokens: Math.max(0, (meta.totalTokenCount ?? inputTokens + outputTokens) - cachedTokens),
    estimatedUsd: null,
    exact: true,
  };
}

export function getAiProvider(): AiProvider {
  if (env.aiProvider === 'openrouter' || env.aiProvider === 'gemini') return env.aiProvider;
  return env.openRouterKey ? 'openrouter' : 'gemini';
}

export function aiConfigured(): boolean {
  return getAiProvider() === 'openrouter' ? !!env.openRouterKey : !!env.geminiKey;
}

export function resolveGenerationModel(model: string, provider: AiProvider = getAiProvider()): string {
  const requested = env.aiModel || model || 'gemini-3.5-flash-lite';
  if (provider === 'openrouter') return requested.includes('/') ? requested : `google/${requested}`;
  return requested.startsWith('google/') ? requested.slice('google/'.length) : requested;
}

export function resolveEmbeddingModel(model: string, provider: AiProvider = getAiProvider()): string {
  const requested = env.aiEmbeddingModel || model || 'auto';
  if (provider === 'openrouter') {
    if (requested === 'auto' || requested === 'gemini-embedding-001') return 'openai/text-embedding-3-small';
    return requested.includes('/') ? requested : `google/${requested}`;
  }
  if (requested === 'auto' || requested.startsWith('openai/')) return 'gemini-embedding-001';
  return requested.startsWith('google/') ? requested.slice('google/'.length) : requested;
}

let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!env.geminiKey) throw new Error('AI is not configured (no GEMINI_API_KEY)');
  if (!geminiClient) geminiClient = new GoogleGenAI({ apiKey: env.geminiKey });
  return geminiClient;
}

function toGeminiSchema(schema: JsonSchema): Schema {
  const typeMap: Record<JsonSchema['type'], Type> = {
    object: Type.OBJECT,
    array: Type.ARRAY,
    string: Type.STRING,
    number: Type.NUMBER,
    integer: Type.INTEGER,
    boolean: Type.BOOLEAN,
  };
  return {
    type: typeMap[schema.type],
    ...(schema.properties
      ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)])) }
      : {}),
    ...(schema.items ? { items: toGeminiSchema(schema.items) } : {}),
    ...(schema.required ? { required: schema.required } : {}),
    ...(schema.enum ? { enum: schema.enum } : {}),
    ...(schema.nullable !== undefined ? { nullable: schema.nullable } : {}),
  } as Schema;
}

function toOpenRouterSchema(schema: JsonSchema): Record<string, unknown> {
  return {
    type: schema.nullable ? [schema.type, 'null'] : schema.type,
    ...(schema.properties
      ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toOpenRouterSchema(value)])) }
      : {}),
    ...(schema.items ? { items: toOpenRouterSchema(schema.items) } : {}),
    ...(schema.required ? { required: schema.required } : {}),
    ...(schema.enum ? { enum: schema.enum } : {}),
    ...(schema.additionalProperties !== undefined ? { additionalProperties: schema.additionalProperties } : {}),
  };
}

function openRouterHeaders(): Record<string, string> {
  if (!env.openRouterKey) throw new Error('AI is not configured (no OPENROUTER_API_KEY)');
  return {
    Authorization: `Bearer ${env.openRouterKey}`,
    'Content-Type': 'application/json',
    ...(env.openRouterSiteUrl ? { 'HTTP-Referer': env.openRouterSiteUrl } : {}),
    ...(env.openRouterAppName ? { 'X-Title': env.openRouterAppName } : {}),
  };
}

async function openRouterPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`https://openrouter.ai/api/v1${path}`, {
    method: 'POST',
    headers: openRouterHeaders(),
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `OpenRouter request failed (${response.status})`);
  return payload;
}

function messageText(message: OpenRouterMessage | undefined): string {
  if (typeof message?.content === 'string') return message.content.trim();
  if (Array.isArray(message?.content)) return message.content.map((part) => part.text ?? '').join('').trim();
  return '';
}

async function openRouterChat(model: string, content: unknown, schema?: JsonSchema, maxOutputTokens?: number): Promise<ProviderResult<string>> {
  const payload = await openRouterPost<OpenRouterChatResponse>('/chat/completions', {
    model: resolveGenerationModel(model, 'openrouter'),
    messages: [{ role: 'user', content }],
    ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
    ...(schema
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'timeblock_response',
              strict: true,
              schema: toOpenRouterSchema({ ...schema, additionalProperties: false }),
            },
          },
        }
      : {}),
  });
  const text = messageText(payload.choices?.[0]?.message);
  if (!text) throw new Error(payload.error?.message || 'OpenRouter returned an empty response');
  return { value: text, usage: openRouterUsage(payload.usage), provider: 'openrouter', model: resolveGenerationModel(model, 'openrouter') };
}

export async function generateTextWithUsage(model: string, prompt: string): Promise<ProviderResult<string>> {
  if (getAiProvider() === 'openrouter') return openRouterChat(model, prompt);
  const response = await getGeminiClient().models.generateContent({ model: resolveGenerationModel(model, 'gemini'), contents: prompt });
  return { value: (response.text ?? '').trim(), usage: geminiUsage(response), provider: 'gemini', model: resolveGenerationModel(model, 'gemini') };
}

export async function generateJsonWithUsage<T>(model: string, prompt: string, schema: JsonSchema, maxOutputTokens?: number): Promise<ProviderResult<T>> {
  if (getAiProvider() === 'openrouter') {
    const result = await openRouterChat(model, prompt, schema, maxOutputTokens);
    return { ...result, value: JSON.parse(result.value || '{}') as T };
  }
  const response = await getGeminiClient().models.generateContent({
    model: resolveGenerationModel(model, 'gemini'),
    contents: prompt,
    config: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema), ...(maxOutputTokens ? { maxOutputTokens } : {}) },
  });
  return { value: JSON.parse(response.text ?? '{}') as T, usage: geminiUsage(response), provider: 'gemini', model: resolveGenerationModel(model, 'gemini') };
}

export async function generateText(model: string, prompt: string): Promise<string> {
  return (await generateTextWithUsage(model, prompt)).value;
}

export async function generateJson<T>(model: string, prompt: string, schema: JsonSchema): Promise<T> {
  return (await generateJsonWithUsage<T>(model, prompt, schema)).value;
}

function audioFormat(mimeType: string): string {
  const subtype = mimeType.toLowerCase().split('/')[1]?.split(';')[0] || 'wav';
  if (subtype === 'mpeg') return 'mp3';
  if (subtype === 'x-wav') return 'wav';
  return subtype;
}

export async function generateAudioJson<T>(
  model: string,
  prompt: string,
  audio: Buffer,
  mimeType: string,
  schema: JsonSchema,
): Promise<T> {
  return (await generateAudioJsonWithUsage<T>(model, prompt, audio, mimeType, schema)).value;
}

export async function generateAudioJsonWithUsage<T>(model: string, prompt: string, audio: Buffer, mimeType: string, schema: JsonSchema): Promise<ProviderResult<T>> {
  if (getAiProvider() === 'openrouter') {
    const content = [
      { type: 'text', text: prompt },
      { type: 'input_audio', input_audio: { data: audio.toString('base64'), format: audioFormat(mimeType) } },
    ];
    const result = await openRouterChat(model, content, schema);
    return { ...result, value: JSON.parse(result.value) as T };
  }
  const response = await getGeminiClient().models.generateContent({
    model: resolveGenerationModel(model, 'gemini'),
    contents: [{ text: prompt }, { inlineData: { mimeType, data: audio.toString('base64') } }],
    config: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema) },
  });
  return { value: JSON.parse(response.text ?? '{}') as T, usage: geminiUsage(response), provider: 'gemini', model: resolveGenerationModel(model, 'gemini') };
}

export async function generateVisionText(model: string, prompt: string, image: Buffer, mimeType: string): Promise<string> {
  return (await generateVisionTextWithUsage(model, prompt, image, mimeType)).value;
}

export async function generateVisionTextWithUsage(model: string, prompt: string, image: Buffer, mimeType: string): Promise<ProviderResult<string>> {
  if (getAiProvider() === 'openrouter') {
    return await openRouterChat(model, [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${image.toString('base64')}` } },
    ]);
  }
  const response = await getGeminiClient().models.generateContent({
    model: resolveGenerationModel(model, 'gemini'),
    contents: [{ text: prompt }, { inlineData: { mimeType, data: image.toString('base64') } }],
  });
  return { value: (response.text ?? '').trim(), usage: geminiUsage(response), provider: 'gemini', model: resolveGenerationModel(model, 'gemini') };
}

export async function embedContent(model: string, texts: string[], dimensions: number): Promise<number[][]> {
  return (await embedContentWithUsage(model, texts, dimensions)).value;
}

export async function embedContentWithUsage(model: string, texts: string[], dimensions: number): Promise<ProviderResult<number[][]>> {
  if (!texts.length) return { value: [], usage: emptyUsage(), provider: getAiProvider(), model: resolveEmbeddingModel(model) };
  if (getAiProvider() === 'openrouter') {
    const payload = await openRouterPost<OpenRouterEmbeddingResponse>('/embeddings', {
      model: resolveEmbeddingModel(model, 'openrouter'),
      input: texts,
      dimensions,
    });
    const value = (payload.data ?? [])
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((item) => item.embedding ?? []);
    return { value, usage: openRouterUsage(payload.usage), provider: 'openrouter', model: resolveEmbeddingModel(model, 'openrouter') };
  }
  const response = await getGeminiClient().models.embedContent({
    model: resolveEmbeddingModel(model, 'gemini'),
    contents: texts,
    config: { outputDimensionality: dimensions },
  });
  return {
    value: (response.embeddings ?? []).map((embedding) => embedding.values ?? []),
    usage: geminiUsage(response as unknown as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number; totalTokenCount?: number } }),
    provider: 'gemini',
    model: resolveEmbeddingModel(model, 'gemini'),
  };
}
