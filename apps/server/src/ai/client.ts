import { GoogleGenAI, Type, type Schema } from '@google/genai';
import { env } from '../config.js';

export type AiProvider = 'gemini' | 'openrouter';

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
  error?: { message?: string };
}

interface OpenRouterEmbeddingResponse {
  data?: Array<{ index?: number; embedding?: number[] }>;
  error?: { message?: string };
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

async function openRouterChat(model: string, content: unknown, schema?: JsonSchema): Promise<string> {
  const payload = await openRouterPost<OpenRouterChatResponse>('/chat/completions', {
    model: resolveGenerationModel(model, 'openrouter'),
    messages: [{ role: 'user', content }],
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
  return text;
}

export async function generateText(model: string, prompt: string): Promise<string> {
  if (getAiProvider() === 'openrouter') return openRouterChat(model, prompt);
  const response = await getGeminiClient().models.generateContent({ model: resolveGenerationModel(model, 'gemini'), contents: prompt });
  return (response.text ?? '').trim();
}

export async function generateJson<T>(model: string, prompt: string, schema: JsonSchema): Promise<T> {
  const text =
    getAiProvider() === 'openrouter'
      ? await openRouterChat(model, prompt, schema)
      : (
          await getGeminiClient().models.generateContent({
            model: resolveGenerationModel(model, 'gemini'),
            contents: prompt,
            config: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema) },
          })
        ).text ?? '';
  return JSON.parse(text || '{}') as T;
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
  if (getAiProvider() === 'openrouter') {
    const content = [
      { type: 'text', text: prompt },
      { type: 'input_audio', input_audio: { data: audio.toString('base64'), format: audioFormat(mimeType) } },
    ];
    return JSON.parse(await openRouterChat(model, content, schema)) as T;
  }
  const response = await getGeminiClient().models.generateContent({
    model: resolveGenerationModel(model, 'gemini'),
    contents: [{ text: prompt }, { inlineData: { mimeType, data: audio.toString('base64') } }],
    config: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(schema) },
  });
  return JSON.parse(response.text ?? '{}') as T;
}

export async function embedContent(model: string, texts: string[], dimensions: number): Promise<number[][]> {
  if (!texts.length) return [];
  if (getAiProvider() === 'openrouter') {
    const payload = await openRouterPost<OpenRouterEmbeddingResponse>('/embeddings', {
      model: resolveEmbeddingModel(model, 'openrouter'),
      input: texts,
      dimensions,
    });
    return (payload.data ?? [])
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((item) => item.embedding ?? []);
  }
  const response = await getGeminiClient().models.embedContent({
    model: resolveEmbeddingModel(model, 'gemini'),
    contents: texts,
    config: { outputDimensionality: dimensions },
  });
  return (response.embeddings ?? []).map((embedding) => embedding.values ?? []);
}
