import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config.js';
import { embedContent, generateJson, resolveEmbeddingModel, resolveGenerationModel } from './client.js';

const originalEnv = {
  aiProvider: env.aiProvider,
  openRouterKey: env.openRouterKey,
  aiModel: env.aiModel,
  aiEmbeddingModel: env.aiEmbeddingModel,
};

beforeEach(() => {
  env.aiProvider = 'openrouter';
  env.openRouterKey = 'test-openrouter-key';
  env.aiModel = '';
  env.aiEmbeddingModel = '';
});

afterEach(() => {
  Object.assign(env, originalEnv);
  vi.unstubAllGlobals();
});

describe('AI provider model resolution', () => {
  it('adds the Google namespace required by OpenRouter', () => {
    expect(resolveGenerationModel('gemini-3.1-flash-lite', 'openrouter')).toBe('google/gemini-3.1-flash-lite');
  });

  it('removes the OpenRouter Google namespace for the direct Gemini SDK', () => {
    expect(resolveGenerationModel('google/gemini-3.1-flash-lite', 'gemini')).toBe('gemini-3.1-flash-lite');
  });

  it('uses the inexpensive OpenAI embedding model for legacy Gemini settings on OpenRouter', () => {
    expect(resolveEmbeddingModel('gemini-embedding-001', 'openrouter')).toBe('openai/text-embedding-3-small');
  });

  it('uses Gemini embeddings when the direct provider receives an automatic setting', () => {
    expect(resolveEmbeddingModel('auto', 'gemini')).toBe('gemini-embedding-001');
  });

  it('sends strict structured-output requests to OpenRouter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"ok"}' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      generateJson<{ answer: string }>('gemini-3.1-flash-lite', 'hello', {
        type: 'object',
        properties: { answer: { type: 'string' }, detail: { type: 'string', nullable: true } },
        required: ['answer', 'detail'],
      }),
    ).resolves.toEqual({ answer: 'ok' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-openrouter-key');
    const requestBody = JSON.parse(String(init.body));
    expect(requestBody).toMatchObject({
      model: 'google/gemini-3.1-flash-lite',
      response_format: { type: 'json_schema', json_schema: { strict: true } },
    });
    expect(requestBody.response_format.json_schema.schema.properties.detail.type).toEqual(['string', 'null']);
  });

  it('preserves embedding order returned by OpenRouter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { index: 1, embedding: [2] },
              { index: 0, embedding: [1] },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    await expect(embedContent('auto', ['first', 'second'], 768)).resolves.toEqual([[1], [2]]);
  });
});
