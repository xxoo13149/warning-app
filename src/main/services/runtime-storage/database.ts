import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import type { DatabaseCandidate, DatabaseCandidateStats } from './types';
import { MAIN_BACKUP_FILE_PATTERN, removeSqliteArtifacts, toErrorMessage } from './shared';

const MIGRATION_ACTIVITY_GRACE_MS = 24 * 60 * 60 * 1000;

export const choosePrimaryDatabase = (
  candidates: readonly DatabaseCandidate[],
): DatabaseCandidate | null => {
  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort(compareDatabaseCandidates)[0] ?? null;
};

export const inspectDatabaseSafely = (dbPath: string): DatabaseCandidateStats | null => {
  try {
    return inspectDatabase(dbPath);
  } catch (error) {
    console.warn(
      `[runtime-storage] skipping unreadable database candidate: ${dbPath} (${toErrorMessage(error)})`,
    );
    return null;
  }
};

const inspectDatabase = (dbPath: string): DatabaseCandidateStats => {
  const sqlite = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    const fileSizeBytes = fs.statSync(dbPath).size;
    const latestPriceTickAt = queryMaxValue(sqlite, 'price_ticks', 'timestamp');
    const latestAlertAt = queryMaxValue(sqlite, 'alert_events', 'triggered_at');
    const latestStateUpdateAt = queryMaxValue(sqlite, 'latest_token_state', 'updated_at');
    const latestSettingUpdateAt = queryMaxValue(sqlite, 'app_settings', 'updated_at');
    const priceTickCount = queryCount(sqlite, 'price_ticks');
    const alertEventCount = queryCount(sqlite, 'alert_events');
    const lastActivityAt = [
      latestPriceTickAt,
      latestAlertAt,
      latestStateUpdateAt,
      latestSettingUpdateAt,
    ].reduce<number | null>((latest, value) => {
      if (value === null) {
        return latest;
      }
      if (latest === null || value > latest) {
        return value;
      }
      return latest;
    }, null);

    return {
      fileSizeBytes,
      priceTickCount,
      alertEventCount,
      latestPriceTickAt,
      latestAlertAt,
      latestStateUpdateAt,
      latestSettingUpdateAt,
      lastActivityAt,
    };
  } finally {
    sqlite.close();
  }
};

const queryCount = (db: Database.Database, tableName: string): number => {
  if (!hasTable(db, tableName)) {
    return 0;
  }

  const row = db
    .prepare(`SELECT COUNT(*) AS value FROM ${tableName}`)
    .get() as { value?: number | bigint | null };
  return toFiniteNumber(row.value) ?? 0;
};

const queryMaxValue = (
  db: Database.Database,
  tableName: string,
  columnName: string,
): number | null => {
  if (!hasTable(db, tableName)) {
    return null;
  }

  const row = db
    .prepare(`SELECT MAX(${columnName}) AS value FROM ${tableName}`)
    .get() as { value?: number | bigint | null };
  return toFiniteNumber(row.value);
};

const hasTable = (db: Database.Database, tableName: string): boolean => {
  const row = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .get(tableName);
  return row !== undefined;
};

const toFiniteNumber = (value: number | bigint | null | undefined): number | null => {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
};

const compareDatabaseCandidates = (left: DatabaseCandidate, right: DatabaseCandidate): number => {
  const leftActivity = left.stats.lastActivityAt ?? 0;
  const rightActivity = right.stats.lastActivityAt ?? 0;
  const activityDelta = Math.abs(leftActivity - rightActivity);
  if (activityDelta > MIGRATION_ACTIVITY_GRACE_MS && leftActivity !== rightActivity) {
    return rightActivity - leftActivity;
  }

  if (left.stats.priceTickCount !== right.stats.priceTickCount) {
    return right.stats.priceTickCount - left.stats.priceTickCount;
  }
  if (left.stats.alertEventCount !== right.stats.alertEventCount) {
    return right.stats.alertEventCount - left.stats.alertEventCount;
  }
  if (leftActivity !== rightActivity) {
    return rightActivity - leftActivity;
  }
  if (left.stats.fileSizeBytes !== right.stats.fileSizeBytes) {
    return right.stats.fileSizeBytes - left.stats.fileSizeBytes;
  }
  if (left.kind !== right.kind) {
    return left.kind === 'runtime-main' ? -1 : 1;
  }
  return left.label.localeCompare(right.label);
};

export const backupDatabase = async (
  sourcePath: string,
  destinationPath: string,
): Promise<void> => {
  if (sourcePath === destinationPath) {
    return;
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  removeSqliteArtifacts(destinationPath);

  const sqlite = new Database(sourcePath, {
    fileMustExist: true,
  });

  try {
    await sqlite.backup(destinationPath);
  } finally {
    sqlite.close();
  }
};

export const inspectLatestMainDatabaseBackup = (
  backupDir: string,
): { backupPath: string | null; backupAt: string | null } => {
  if (!fs.existsSync(backupDir)) {
    return {
      backupPath: null,
      backupAt: null,
    };
  }

  const candidates = fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && MAIN_BACKUP_FILE_PATTERN.test(entry.name))
    .map((entry) => {
      const backupPath = path.join(backupDir, entry.name);
      const stats = fs.statSync(backupPath);
      const backupTimeMs = stats.mtimeMs > 0 ? stats.mtimeMs : Math.max(stats.birthtimeMs, 0);
      return {
        backupPath,
        backupTimeMs,
      };
    })
    .sort((left, right) => {
      if (right.backupTimeMs !== left.backupTimeMs) {
        return right.backupTimeMs - left.backupTimeMs;
      }
      return right.backupPath.localeCompare(left.backupPath);
    });

  const latest = candidates[0];
  if (!latest) {
    return {
      backupPath: null,
      backupAt: null,
    };
  }

  return {
    backupPath: latest.backupPath,
    backupAt: latest.backupTimeMs > 0 ? new Date(latest.backupTimeMs).toISOString() : null,
  };
};
