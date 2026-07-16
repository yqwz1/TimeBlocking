import fs from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import { DATA_DIR, DB_PATH, MIGRATIONS_DIR } from '../config.js';

export type DB = BetterSQLite3Database<typeof schema>;

export function createDb(dbPath: string = DB_PATH): DB {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}
