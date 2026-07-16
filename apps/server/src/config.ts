import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const DB_PATH = path.join(DATA_DIR, 'timeblock.db');
export const WEB_DIST = path.join(ROOT_DIR, 'apps', 'web', 'dist');
export const MIGRATIONS_DIR = path.join(__dirname, 'db', 'migrations');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

export const env = {
  port: Number(process.env.PORT || 4141),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  geminiKey: process.env.GEMINI_API_KEY || '',
  isProd: process.env.NODE_ENV === 'production',
};

export const OAUTH_CALLBACK_PATH = '/oauth2callback';
export const OAUTH_REDIRECT_URI = `http://127.0.0.1:${env.port}${OAUTH_CALLBACK_PATH}`;

export function nowUtcIso(): string {
  return new Date().toISOString();
}
