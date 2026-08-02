import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { env, OAUTH_CALLBACK_PATH, WEB_DIST } from './config.js';
import { createDb } from './db/client.js';
import { ensureTimezoneDefault, getSettings } from './settings.js';
import { SyncManager } from './sync/manager.js';
import { registerApiRoutes } from './routes/index.js';
import { handleOAuthCallback } from './integrations/google/auth.js';
import { getVaultRoot } from './notes/vault.js';
import { reindexAll } from './notes/indexer.js';
import { triggerGraphRecompute } from './notes/graph/recompute.js';
import { triggerConceptExtraction } from './notes/concepts/recompute.js';
import { completeGraphJob, failGraphJob, recoverInterruptedGraphJobs, startGraphJob } from './notes/graph/jobs.js';
import { reembedAllNotes } from './notes/embeddings.js';
import { aiConfigured } from './ai/client.js';
import { DriveBackupService } from './integrations/google/driveBackups.js';
import { WorkoutEngineService } from './workout/engine.js';

async function main() {
  const db = createDb();
  ensureTimezoneDefault(db);
  const vaultRoot = getVaultRoot(db);
  await reindexAll(db, vaultRoot);
  const interruptedJobs = recoverInterruptedGraphJobs(db);
  triggerGraphRecompute(db);
  triggerConceptExtraction(db, vaultRoot);
  if (interruptedJobs.includes('embeddings')) {
    const settings = getSettings(db);
    startGraphJob(db, 'embeddings');
    void reembedAllNotes(db, vaultRoot, settings.aiEnabled && aiConfigured(), settings.aiEmbeddingModel)
      .then(() => completeGraphJob(db, 'embeddings'))
      .catch((error) => failGraphJob(db, 'embeddings', error));
  }

  const manager = new SyncManager(db);
  const driveBackups = new DriveBackupService(db);
  const workout = new WorkoutEngineService(db);

  const app = Fastify({ logger: { level: env.isProd ? 'warn' : 'info' } });
  await app.register(cors, { origin: env.isProd ? (env.integrationOrigin || false) : true });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  await app.register(
    async (api) => {
      registerApiRoutes(api, db, manager, driveBackups, workout);
    },
    { prefix: '/api' },
  );

  app.get<{ Querystring: { code?: string; error?: string } }>(OAUTH_CALLBACK_PATH, async (req, reply) => {
    const clientOrigin = env.isProd ? '' : 'http://localhost:5173';
    if (req.query.error || !req.query.code) {
      return reply.type('text/html').send(`<p>Google authorization failed (${req.query.error ?? 'no code returned'}). You can close this tab and retry.</p>`);
    }
    try {
      await handleOAuthCallback(db, req.query.code);
    } catch (err) {
      return reply.type('text/html').send(`<p>Google authorization failed: ${err instanceof Error ? err.message : String(err)}</p>`);
    }
    void manager.runCycle('oauth-callback', { forceGoogle: true });
    return reply.redirect(`${clientOrigin}/setup?connected=1`);
  });

  if (env.isProd) {
    await app.register(fastifyStatic, { root: WEB_DIST });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  manager.start();
  // A lightweight scheduler only enqueues when the configured interval is due;
  // DriveBackupService makes concurrent/manual requests single-flight.
  setInterval(() => { void driveBackups.runScheduled(); }, 60 * 60 * 1000).unref();
  void driveBackups.runScheduled();

  await app.listen({ port: env.port, host: '127.0.0.1' });
  console.log(`TimeBlock server listening on http://127.0.0.1:${env.port}`);
  (process as unknown as { parentPort?: { postMessage(msg: unknown): void } }).parentPort?.postMessage({
    type: 'ready',
    port: env.port,
  });
}

main().catch((err) => {
  console.error('Fatal boot error:', err);
  process.exit(1);
});
