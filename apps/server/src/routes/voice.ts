import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { DB } from '../db/client.js';
import { labels as labelsTable, projects as projectsTable } from '../db/schema.js';
import { aiConfigured } from '../ai/client.js';
import { interpretVoiceAudio, VoiceNoSpeechError } from '../ai/voice.js';
import { ModelGateway } from '../assistant/modelGateway.js';
import { getSettings } from '../settings.js';

const MAX_VOICE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_AUDIO = new Set(['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/aiff']);

export function registerVoiceRoutes(app: FastifyInstance, db: DB) {
  app.post('/voice/interpret', async (req, reply) => {
    const settings = getSettings(db);
    if (!settings.aiEnabled || !aiConfigured())
      return reply.code(501).send({ error: 'Voice capture requires enabled AI features and a configured OpenRouter or Gemini API key.' });

    let audio: Buffer | null = null;
    let mimeType = '';
    let browserTranscript = '';

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'audio' || audio) {
          part.file.resume();
          continue;
        }
        mimeType = part.mimetype.toLocaleLowerCase().split(';')[0];
        audio = await part.toBuffer();
      } else if (part.fieldname === 'browserTranscript') {
        browserTranscript = String(part.value ?? '').slice(0, 4000);
      }
    }

    if (!audio?.length) return reply.code(400).send({ error: 'No audio was uploaded.' });
    if (audio.length > MAX_VOICE_BYTES) return reply.code(413).send({ error: 'The voice recording is too large.' });
    if (!SUPPORTED_AUDIO.has(mimeType)) return reply.code(415).send({ error: 'Unsupported audio format. Please record WAV audio.' });

    const projects = db
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .where(eq(projectsTable.archived, 0))
      .all();
    const labels = db.select({ name: labelsTable.name }).from(labelsTable).all().map((label) => label.name);

    try {
      return await interpretVoiceAudio(new ModelGateway(db), settings.aiModel, audio, mimeType, browserTranscript, {
        timezone: settings.timezone,
        now: DateTime.now().setZone(settings.timezone),
        projects,
        labels,
      });
    } catch (error) {
      if (error instanceof VoiceNoSpeechError) return reply.code(422).send({ error: error.message });
      req.log.error({ err: error }, 'voice interpretation failed');
      return reply.code(502).send({ error: 'The recording could not be interpreted. Please try again.' });
    }
  });
}
