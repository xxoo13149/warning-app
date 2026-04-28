import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { applyDbMigrations } from './migrations';

export interface DbConnection {
  sqlite: Database.Database;
  orm: ReturnType<typeof drizzle<typeof schema>>;
}

export function createDbConnection(dbPath: string): DbConnection {
  ensureParentDir(dbPath);

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('journal_size_limit = 0');

  applyDbMigrations(sqlite);

  const orm = drizzle(sqlite, { schema });
  return { sqlite, orm };
}

export function closeDbConnection(connection: DbConnection): void {
  connection.sqlite.close();
}

function ensureParentDir(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
