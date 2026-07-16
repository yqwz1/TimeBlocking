import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { env, OAUTH_CALLBACK_PATH, WEB_DIST } from './config.js';
import { createDb } from './db/client.js';
import { ensureTimezoneDefault } from './settings.js';
import { SyncManager } from './sync/manager.js';
import { registerApiRoutes } from './routes/index.js';
import { handleOAuthCallback } from './integrations/google/auth.js';

async function main() {
  const db = createDb();
  ensureTimezoneDefault(db);

  const manager = new SyncManager(db);

  const app = Fastify({ logger: { level: env.isProd ? 'warn' : 'info' } });
  await app.register(cors, { origin: env.isProd ? false : true });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  await app.register(
    async (api) => {
      registerApiRoutes(api, db, manager);
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

  await app.listen({ port: env.port, host: '127.0.0.1' });
  console.log(`TimeBlock server listening on http://127.0.0.1:${env.port}`);
}

main().catch((err) => {
  console.error('Fatal boot error:', err);
  process.exit(1);
});
