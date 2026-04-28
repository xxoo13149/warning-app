import fs from 'node:fs';

import type {
  RuntimeStorageSummary,
  StorageBackupResult,
  StorageCleanupResult,
} from '../../../shared/monitor-contracts';
import {
  ensureRuntimeDirectories,
  type RuntimePaths,
} from '../runtime-paths';
import { backupDatabase, inspectDatabaseSafely, inspectLatestMainDatabaseBackup } from './database';
import { EMPTY_DATABASE_CANDIDATE_STATS } from './types';
import {
  collectClearableSessionCacheTargets,
  inspectPathFootprint,
  inspectPathSize,
  inspectSqliteBundleSize,
  pruneEmptyPartitionDirectories,
  readLastCacheCleanupAt,
  resolveLastCacheCleanupPath,
  resolvePrimarySelectionPath,
  resolveStorageBackupPath,
  toIsoOrNull,
  toSessionCacheEntryLabel,
  writeLastCacheCleanupAt,
} from './shared';

export const inspectRuntimeStorageSummary = (
  runtimePaths: RuntimePaths,
): RuntimeStorageSummary => {
  const latestMainBackup = inspectLatestMainDatabaseBackup(runtimePaths.backupDir);
  const mainDbExists = fs.existsSync(runtimePaths.mainDbPath);
  const stats = mainDbExists
    ? inspectDatabaseSafely(runtimePaths.mainDbPath) ?? EMPTY_DATABASE_CANDIDATE_STATS
    : EMPTY_DATABASE_CANDIDATE_STATS;
  const databaseSizeBytes = inspectSqliteBundleSize(runtimePaths.mainDbPath);
  const archiveFootprint = inspectPathFootprint(runtimePaths.archiveDir);
  const backupFootprint = inspectPathFootprint(runtimePaths.backupDir);
  const sessionDataFootprint = inspectPathFootprint(runtimePaths.sessionDataDir);
  const logsFootprint = inspectPathFootprint(runtimePaths.logsDir);
  const archiveSizeBytes = archiveFootprint.sizeBytes;
  const backupSizeBytes = backupFootprint.sizeBytes;
  const sessionDataSizeBytes = sessionDataFootprint.sizeBytes;
  const logsSizeBytes = logsFootprint.sizeBytes;
  const housekeepingSizeBytes =
    inspectPathSize(resolvePrimarySelectionPath(runtimePaths)) +
    inspectPathSize(resolveLastCacheCleanupPath(runtimePaths));
  const totalSizeBytes =
    databaseSizeBytes +
    archiveSizeBytes +
    backupSizeBytes +
    sessionDataSizeBytes +
    logsSizeBytes +
    housekeepingSizeBytes;
  const cleanableTargets = collectClearableSessionCacheTargets(runtimePaths.sessionDataDir);
  const cleanableSizeBytes = cleanableTargets.reduce(
    (total, targetPath) => total + inspectPathSize(targetPath),
    0,
  );
  const cleanableEntryCount = cleanableTargets.length;
  const sessionPersistentSizeBytes = Math.max(0, sessionDataSizeBytes - cleanableSizeBytes);
  const lastCleanupAt = readLastCacheCleanupAt(runtimePaths);

  return {
    dataRootDir: runtimePaths.dataRootDir,
    mainDbPath: runtimePaths.mainDbPath,
    archiveDir: runtimePaths.archiveDir,
    backupDir: runtimePaths.backupDir,
    sessionDataDir: runtimePaths.sessionDataDir,
    logsDir: runtimePaths.logsDir,
    mainDbExists,
    mainDbSizeBytes: databaseSizeBytes || stats.fileSizeBytes,
    totalSizeBytes,
    databaseSizeBytes: databaseSizeBytes || stats.fileSizeBytes,
    archiveSizeBytes,
    backupSizeBytes,
    sessionDataSizeBytes,
    logsSizeBytes,
    cleanableSizeBytes,
    cleanableEntryCount,
    sessionPersistentSizeBytes,
    archiveFileCount: archiveFootprint.fileCount,
    backupFileCount: backupFootprint.fileCount,
    logFileCount: logsFootprint.fileCount,
    latestLogAt: toIsoOrNull(logsFootprint.latestUpdatedAt),
    canClearCache: cleanableSizeBytes > 0,
    lastCleanupAt,
    priceTickCount: stats.priceTickCount,
    alertEventCount: stats.alertEventCount,
    latestPriceTickAt: toIsoOrNull(stats.latestPriceTickAt),
    latestAlertAt: toIsoOrNull(stats.latestAlertAt),
    lastActivityAt: toIsoOrNull(stats.lastActivityAt),
    latestMainBackupPath: latestMainBackup.backupPath,
    latestMainBackupAt: latestMainBackup.backupAt,
    latestBackupPath: latestMainBackup.backupPath,
    latestBackupAt: latestMainBackup.backupAt,
  };
};

export const clearRuntimeStorageCache = async (
  runtimePaths: RuntimePaths,
): Promise<StorageCleanupResult> => {
  ensureRuntimeDirectories(runtimePaths);

  const targets = collectClearableSessionCacheTargets(runtimePaths.sessionDataDir);
  let reclaimedBytes = 0;
  const deletedEntries: string[] = [];

  for (const targetPath of targets) {
    if (!fs.existsSync(targetPath)) {
      continue;
    }

    reclaimedBytes += inspectPathSize(targetPath);
    fs.rmSync(targetPath, { recursive: true, force: true });
    deletedEntries.push(toSessionCacheEntryLabel(runtimePaths.sessionDataDir, targetPath));
  }

  pruneEmptyPartitionDirectories(runtimePaths.sessionDataDir);
  writeLastCacheCleanupAt(runtimePaths, new Date().toISOString());

  return {
    reclaimedBytes,
    deletedEntries,
    storageSummary: inspectRuntimeStorageSummary(runtimePaths),
  };
};

export const createRuntimeStorageBackup = async (
  runtimePaths: RuntimePaths,
): Promise<StorageBackupResult> => {
  ensureRuntimeDirectories(runtimePaths);
  if (!fs.existsSync(runtimePaths.mainDbPath)) {
    throw new Error('Main database does not exist.');
  }

  const backupPath = resolveStorageBackupPath(runtimePaths.backupDir, new Date());
  await backupDatabase(runtimePaths.mainDbPath, backupPath);

  return {
    backupPath,
    storageSummary: inspectRuntimeStorageSummary(runtimePaths),
  };
};
