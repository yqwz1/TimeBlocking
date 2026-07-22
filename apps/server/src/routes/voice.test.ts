import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type DB } from '../db/client.js';
import { updateSettings } from '../settings.js';

const mocks = vi.hoisted(() => ({
  configured: vi.fn(() => true),
  interpret: vi.fn(),
}));

vi.mock('../ai/client.js', () => ({ aiConfigured: mocks.configured }));
vi.mock('../ai/voice.js', () => ({
  VoiceNoSpeechError: class VoiceNoSpeechError extends Error {},
  interpretVoiceAudio: mocks.interpret,
}));

import { registerVoiceRoutes } from './voice.js';

const boundary = '----timeblock-voice-test';

function multipartPayload(file?: { mime: string; data: Buffer }, transcript = ''): Buffer {
  const chunks: Buffer[] = [];
  const add = (value: string | Buffer) => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  if (transcript) {
    add(`--${boundary}\r\nContent-Disposition: form-data; name="browserTranscript"\r\n\r\n${transcript}\r\n`);
  }
  if (file) {
    add(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="voice.wav"\r\nContent-Type: ${file.mime}\r\n\r\n`);
    add(file.data);
    add('\r\n');
  }
  add(`--${boundary}--\r\n`);
  return Buffer.concat(chunks);
}

describe('POST /voice/interpret', () => {
  let db: DB;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    mocks.configured.mockReturnValue(true);
    mocks.interpret.mockReset();
    db = createDb(':memory:');
    app = Fastify();
    await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
    registerVoiceRoutes(app, db);
    await app.ready();
  });

  afterEach(async () => app.close());

  const inject = (payload: Buffer) =>
    app.inject({ method: 'POST', url: '/voice/interpret', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });

  it('requires enabled and configured AI', async () => {
    updateSettings(db, { aiEnabled: false });
    const response = await inject(multipartPayload({ mime: 'audio/wav', data: Buffer.from('wav') }));
    expect(response.statusCode).toBe(501);
    expect(mocks.interpret).not.toHaveBeenCalled();
  });

  it('rejects a request without audio', async () => {
    const response = await inject(multipartPayload(undefined, 'hello'));
    expect(response.statusCode).toBe(400);
  });

  it('rejects unsupported audio formats', async () => {
    const response = await inject(multipartPayload({ mime: 'audio/webm', data: Buffer.from('webm') }));
    expect(response.statusCode).toBe(415);
  });

  it('rejects recordings over the endpoint limit', async () => {
    const response = await inject(multipartPayload({ mime: 'audio/wav', data: Buffer.alloc(10 * 1024 * 1024 + 1) }));
    expect(response.statusCode).toBe(413);
  });

  it('passes WAV audio and provisional transcript to the interpreter', async () => {
    const result = {
      transcript: 'Add a task to call Omar',
      language: 'en',
      intent: 'task',
      task: { content: 'Call Omar', description: '', projectId: null, priority: null, dueDate: null, dueDatetimeUtc: null, durationMin: null, difficulty: null, labels: [] },
      note: null,
      warnings: [],
    };
    mocks.interpret.mockResolvedValue(result);
    const response = await inject(multipartPayload({ mime: 'audio/wav', data: Buffer.from('wav-bytes') }, 'add a task'));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(mocks.interpret).toHaveBeenCalledWith(
      'gemini-3.5-flash-lite',
      expect.any(Buffer),
      'audio/wav',
      'add a task',
      expect.objectContaining({ timezone: expect.any(String) }),
    );
  });
});
