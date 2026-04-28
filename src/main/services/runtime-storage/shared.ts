import fs from 'node:fs';
import path from 'node:path';

import { APP_NAME } from '../../../shared/constants';
import type { RuntimePaths } from '../runtime-paths';
import type {
  DatabaseCandidate,
  PathFootprint,
  RuntimeCacheCleanupRecord,
  RuntimeStoragePrimarySelection,
} from './types';

export const LEGACY_DB_FILENAME = 'polymarket-weather-monitor.sqlite';
const PRIMARY_SELECTION_FILE_NAME = 'primary-storage.json';
const LAST_CACHE_CLEANUP_FILE_NAME = 'last-cache-cleanup.json';
const SQLITE_SIDE_CAR_SUFFIXES = ['', '-shm', '-wal'];
const CLEARABLE_SESSION_ENTRY_NAMES = [
  'Cache',
  'Code Cache',
  'DawnCache',
  'GPUCache',
  'GrShaderCache',
  'Network',
  'Service Worker',
  'Shared Dictionary',
] as const;
const SESSION_DATA_ENTRY_NAMES = [
  'Code Cache',
  'Cookies',
  'Cookies-journal',
  'DawnCache',
  'GPUCache',
  'IndexedDB',
  'Local Storage',
  'Network',
  'Partitions',
  'Service Worker',
  'Session Storage',
  'Shared Dictionary',
];
const LEGACY_USER_DATA_DIR_NAMES = ['Polymarket Weather Monitor', APP_NAME];

export const MAIN_BACKUP_FILE_PATTERN = /^main-backup-.*\.sqlite$/i;

export const resolveLegacyUserDataDirs = (appDataDir: string): string[] =>
  Array.from(
    new Set(
      LEGACY_USER_DATA_DIR_NAMES.map((directoryName) =>
        path.join(appDataDir, directoryName),
      ),
    ),
  );

export const copyableSessionDataEntryNames = (): readonly string[] => SESSION_DATA_ENTRY_NAMES;

export const resolvePrimarySelectionPath = (runtimePaths: RuntimePaths): string =>
  path.join(runtimePaths.dataRootDir, PRIMARY_SELECTION_FILE_NAME);

export const readPrimarySelection = (
  runtimePaths: RuntimePaths,
): RuntimeStoragePrimarySelection | null => {
  const selectionPath = resolvePrimarySelectionPath(runtimePaths);
  if (!fs.existsSync(selectionPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      fs.readFileSync(selectionPath, 'utf8'),
    ) as Partial<RuntimeStoragePrimarySelection>;
    if (
      parsed?.version !== 1 ||
      typeof parsed.mainDbPath !== 'string' ||
      parsed.mainDbPath !== runtimePaths.mainDbPath
    ) {
      return null;
    }

    return {
      version: 1,
      sealedAt:
        typeof parsed.sealedAt === 'string' && parsed.sealedAt.trim()
          ? parsed.sealedAt
          : new Date(0).toISOString(),
      mainDbPath: parsed.mainDbPath,
      sourceDbPath: typeof parsed.sourceDbPath === 'string' ? parsed.sourceDbPath : null,
      sourceName: typeof parsed.sourceName === 'string' ? parsed.sourceName : null,
      manifestPath: typeof parsed.manifestPath === 'string' ? parsed.manifestPath : null,
    };
  } catch {
    return null;
  }
};

export const writePrimarySelection = (
  runtimePaths: RuntimePaths,
  chosen: Pick<DatabaseCandidate, 'dbPath' | 'sourceName'> | null,
  manifestPath: string | null,
): void => {
  const selectionPath = resolvePrimarySelectionPath(runtimePaths);
  const payload: RuntimeStoragePrimarySelection = {
    version: 1,
    sealedAt: new Date().toISOString(),
    mainDbPath: runtimePaths.mainDbPath,
    sourceDbPath: chosen?.dbPath ?? null,
    sourceName: chosen?.sourceName ?? null,
    manifestPath,
  };
  fs.writeFileSync(selectionPath, JSON.stringify(payload, null, 2), 'utf8');
};

export const inspectPathSize = (targetPath: string): number => inspectPathFootprint(targetPath).sizeBytes;

export const inspectPathFootprint = (targetPath: string): PathFootprint => {
  if (!fs.existsSync(targetPath)) {
    return {
      sizeBytes: 0,
      fileCount: 0,
      latestUpdatedAt: null,
    };
  }

  const stats = fs.statSync(targetPath);
  if (stats.isFile()) {
    return {
      sizeBytes: stats.size,
      fileCount: 1,
      latestUpdatedAt: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : null,
    };
  }

  if (!stats.isDirectory()) {
    return {
      sizeBytes: 0,
      fileCount: 0,
      latestUpdatedAt: null,
    };
  }

  return fs.readdirSync(targetPath).reduce<PathFootprint>(
    (total, entryName) => {
      const entryFootprint = inspectPathFootprint(path.join(targetPath, entryName));
      return {
        sizeBytes: total.sizeBytes + entryFootprint.sizeBytes,
        fileCount: total.fileCount + entryFootprint.fileCount,
        latestUpdatedAt: maxTimestamp(total.latestUpdatedAt, entryFootprint.latestUpdatedAt),
      };
    },
    {
      sizeBytes: 0,
      fileCount: 0,
      latestUpdatedAt: null,
    },
  );
};

export const inspectSqliteBundleSize = (dbPath: string): number =>
  SQLITE_SIDE_CAR_SUFFIXES.reduce((total, suffix) => total + inspectPathSize(`${dbPath}${suffix}`), 0);

export const collectClearableSessionCacheTargets = (sessionDataDir: string): string[] => {
  const targetPaths = new Set<string>();

  for (const entryName of CLEARABLE_SESSION_ENTRY_NAMES) {
    const targetPath = path.join(sessionDataDir, entryName);
    if (fs.existsSync(targetPath)) {
      targetPaths.add(targetPath);
    }
  }

  const partitionsDir = path.join(sessionDataDir, 'Partitions');
  if (!fs.existsSync(partitionsDir)) {
    return [...targetPaths];
  }

  for (const partitionEntry of fs.readdirSync(partitionsDir, { withFileTypes: true })) {
    if (!partitionEntry.isDirectory()) {
      continue;
    }

    for (const entryName of CLEARABLE_SESSION_ENTRY_NAMES) {
      const targetPath = path.join(partitionsDir, partitionEntry.name, entryName);
      if (fs.existsSync(targetPath)) {
        targetPaths.add(targetPath);
      }
    }
  }

  return [...targetPaths].sort((left, right) => left.localeCompare(right));
};

export const pruneEmptyPartitionDirectories = (sessionDataDir: string): void => {
  const partitionsDir = path.join(sessionDataDir, 'Partitions');
  if (!fs.existsSync(partitionsDir)) {
    return;
  }

  for (const partitionEntry of fs.readdirSync(partitionsDir, { withFileTypes: true })) {
    if (!partitionEntry.isDirectory()) {
      continue;
    }

    const partitionPath = path.join(partitionsDir, partitionEntry.name);
    if (fs.readdirSync(partitionPath).length === 0) {
      fs.rmSync(partitionPath, { recursive: true, force: true });
    }
  }
};

export const toSessionCacheEntryLabel = (sessionDataDir: string, targetPath: string): string => {
  const relativePath = path.relative(sessionDataDir, targetPath).replace(/\\/g, '/');
  return relativePath || path.basename(targetPath);
};

export const resolveLastCacheCleanupPath = (runtimePaths: RuntimePaths): string =>
  path.join(runtimePaths.dataRootDir, LAST_CACHE_CLEANUP_FILE_NAME);

export const readLastCacheCleanupAt = (runtimePaths: RuntimePaths): string | null => {
  const recordPath = resolveLastCacheCleanupPath(runtimePaths);
  if (!fs.existsSync(recordPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      fs.readFileSync(recordPath, 'utf8'),
    ) as Partial<RuntimeCacheCleanupRecord>;
    return typeof parsed.cleanedAt === 'string' && parsed.cleanedAt.trim() ? parsed.cleanedAt : null;
  } catch {
    return null;
  }
};

export const writeLastCacheCleanupAt = (
  runtimePaths: RuntimePaths,
  cleanedAt: string,
): void => {
  const recordPath = resolveLastCacheCleanupPath(runtimePaths);
  const payload: RuntimeCacheCleanupRecord = {
    version: 1,
    cleanedAt,
  };
  fs.writeFileSync(recordPath, JSON.stringify(payload, null, 2), 'utf8');
};

export const removeSqliteArtifacts = (dbPath: string): void => {
  for (const suffix of SQLITE_SIDE_CAR_SUFFIXES) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
};

export const resolveStorageBackupPath = (backupDir: string, createdAt: Date): string => {
  const basePath = path.join(backupDir, `main-backup-${createTimestampTag(createdAt)}`);
  let candidatePath = `${basePath}.sqlite`;
  let suffix = 1;

  while (fs.existsSync(candidatePath)) {
    candidatePath = `${basePath}-${suffix}.sqlite`;
    suffix += 1;
  }

  return candidatePath;
};

export const createTimestampTag = (value: Date): string =>
  [
    value.getFullYear().toString().padStart(4, '0'),
    (value.getMonth() + 1).toString().padStart(2, '0'),
    value.getDate().toString().padStart(2, '0'),
    '-',
    value.getHours().toString().padStart(2, '0'),
    value.getMinutes().toString().padStart(2, '0'),
    value.getSeconds().toString().padStart(2, '0'),
  ].join('');

export const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const toIsoOrNull = (value: number | null): string | null =>
  value === null ? null : new Date(value).toISOString();

export const maxTimestamp = (left: number | null, right: number | null): number | null => {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return Math.max(left, right);
};
