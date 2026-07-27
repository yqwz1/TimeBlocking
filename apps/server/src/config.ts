import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
export const DATA_DIR = process.env.TB_DATA_DIR || path.join(ROOT_DIR, 'data');
export const DB_PATH = path.join(DATA_DIR, 'timeblock.db');
export const WEB_DIST = process.env.TB_WEB_DIST || path.join(ROOT_DIR, 'apps', 'web', 'dist');
export const MIGRATIONS_DIR = process.env.TB_MIGRATIONS_DIR || path.join(__dirname, 'db', 'migrations');

const dataEnvPath = path.join(DATA_DIR, '.env');
dotenv.config({ path: fs.existsSync(dataEnvPath) ? dataEnvPath : path.join(ROOT_DIR, '.env') });

export const env = {
  port: Number(process.env.PORT || 4141),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  /** 32+ byte secret used to AES-GCM encrypt persisted OAuth refresh tokens. */
  tokenEncryptionKey: process.env.TB_TOKEN_ENCRYPTION_KEY || '',
  geminiKey: process.env.GEMINI_API_KEY || '',
  openRouterKey: process.env.OPENROUTER_API_KEY || '',
  aiProvider: (process.env.AI_PROVIDER || '').toLowerCase(),
  aiModel: process.env.AI_MODEL || '',
  aiEmbeddingModel: process.env.AI_EMBEDDING_MODEL || '',
  openRouterSiteUrl: process.env.OPENROUTER_SITE_URL || '',
  openRouterAppName: process.env.OPENROUTER_APP_NAME || 'TimeBlocking',
  integrationToken: process.env.TB_INTEGRATION_TOKEN || '',
  integrationOrigin: process.env.TB_INTEGRATION_ORIGIN || '',
  publicAppUrl: (process.env.TB_PUBLIC_APP_URL || `http://127.0.0.1:${process.env.PORT || 4141}`).replace(/\/$/, ''),
  timeblockAppUrl: (process.env.TB_TIMEBLOCK_APP_URL || `http://127.0.0.1:${process.env.PORT || 4141}`).replace(/\/$/, ''),
  integrationEventLog: process.env.TB_INTEGRATION_EVENT_LOG !== 'false',
  isProd: process.env.NODE_ENV === 'production',
};

export const OAUTH_CALLBACK_PATH = '/oauth2callback';
export const OAUTH_REDIRECT_URI = `http://127.0.0.1:${env.port}${OAUTH_CALLBACK_PATH}`;

export function nowUtcIso(): string {
  return new Date().toISOString();
}
