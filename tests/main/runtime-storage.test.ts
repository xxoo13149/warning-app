import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface DatabaseFixture {
  priceTickCount: number;
  alertEventCount: number;
  latestPriceTickAt: number | null;
  latestAlertAt: number | null;
  latestStateUpdateAt: number | null;
  latestSettingUpdateAt: number | null;
}

const { databaseFixtures, databaseOpenErrors } = vi.hoisted(() => ({
  databaseFixtures: new Map<string, DatabaseFixture>(),
  databaseOpenErrors: new Map<string, string>(),
}));

vi.mock('better-sqlite3', async () => {
  const nodeFs = await import('node:fs');
  const nodePath = await import('node:path');

  class MockDatabase {
    private readonly dbPath: string;

    constructor(dbPath: string) {
      this.dbPath = dbPath;
      const openError = databaseOpenErrors.get(dbPath);
      if (openError) {
        throw new Error(openError);
      }
      if (!databaseFixtures.has(dbPath) && !nodeFs.existsSync(dbPath)) {
        throw new Error(`Missing database fixture for ${dbPath}`);
      }
    }

    prepare(sql: string) {
      return {
        get: (tableName?: string) => resolveQuery(this.dbPath, sql, tableName),
      };
    }

    async backup(destinationPath: string): Promise<void> {
      const fixture = databaseFixtures.get(this.dbPath);
      if (!fixture) {
        throw new Error(`Missing database fixture for ${this.dbPath}`);
      }

      nodeFs.mkdirSync(nodePath.dirname(destinationPath), { recursive: true });
      nodeFs.writeFileSync(destinationPath, JSON.stringify(fixture), 'utf8');
      databaseFixtures.set(destinationPath, { ...fixture });
      databaseOpenErrors.delete(destinationPath);
    }

    close(): void {
      return undefined;
    }
  }

  return {
    default: MockDatabase,
  };
});

import {
  clearRuntimeStorageCache,
  createRuntimeStorageBackup,
  choosePrimaryDatabase,
  inspectLatestMainDatabaseBackup,
  inspectRuntimeStorageSummary,
  prepareRuntimeStorage,
  type DatabaseCandidate,
} from '../../src/main/services/runtime-storage';
import { resolveRuntimePaths } from '../../src/main/services/runtime-paths';

describe('runtime storage migration', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    databaseFixtures.clear();
    databaseOpenErrors.clear();
    for (const directoryPath of tempDirs.splice(0)) {
      fs.rmSync(directoryPath, { recursive: true, force: true });
    }
  });

  it('prefers the existing runtime main database when candidates are otherwise tied', () => {
    const sharedStats = {
      fileSizeBytes: 1_024,
      priceTickCount: 10,
      alertEventCount: 4,
      latestPriceTickAt: 10,
      latestAlertAt: 10,
      latestStateUpdateAt: 10,
      latestSettingUpdateAt: 10,
      lastActivityAt: 10,
    };
    const runtimeCandidate: DatabaseCandidate = {
      kind: 'runtime-main',
      label: 'runtime-main',
      sourceName: 'runtime-main',
      dbPath: 'D:\\runtime\\main.sqlite',
      userDataDir: 'D:\\runtime',
      stats: sharedStats,
    };
    const legacyCandidate: DatabaseCandidate = {
      kind: 'legacy',
      label: 'legacy-1',
      sourceName: 'legacy',
      dbPath: 'C:\\legacy\\polymarket-weather-monitor.sqlite',
      userDataDir: 'C:\\legacy',
      stats: sharedStats,
    };

    expect(choosePrimaryDatabase([legacyCandidate, runtimeCandidate])).toEqual(runtimeCandidate);
  });

  it('backs up legacy databases, promotes the chosen main db, and moves session data to D root', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-storage-'));
    tempDirs.push(tempRoot);

    const appDataDir = path.join(tempRoot, 'app-data');
    const runtimeRootDir = path.join(tempRoot, 'weather-runtime');
    const englishLegacyDir = path.join(appDataDir, 'Polymarket Weather Monitor');
    const chineseLegacyDir = path.join(appDataDir, '天气监控');
    fs.mkdirSync(englishLegacyDir, { recursive: true });
    fs.mkdirSync(chineseLegacyDir, { recursive: true });

    seedLegacyDatabase(path.join(englishLegacyDir, 'polymarket-weather-monitor.sqlite'), {
      tickCount: 5,
      alertCount: 3,
      lastTickAt: 1_700_000_000_000,
      lastAlertAt: 1_700_000_100_000,
    });
    seedLegacyDatabase(path.join(chineseLegacyDir, 'polymarket-weather-monitor.sqlite'), {
      tickCount: 2,
      alertCount: 4,
      lastTickAt: 1_700_000_200_000,
      lastAlertAt: 1_700_000_300_000,
    });

    const partitionsDir = path.join(englishLegacyDir, 'Partitions');
    fs.mkdirSync(partitionsDir, { recursive: true });
    fs.writeFileSync(path.join(partitionsDir, 'partition-state.txt'), 'session-state', 'utf8');

    const appMock = {
      getPath: vi.fn((name: string) => {
        if (name === 'appData') {
          return appDataDir;
        }
        throw new Error(`Unsupported path request: ${name}`);
      }),
      setPath: vi.fn(),
      setAppLogsPath: vi.fn(),
    };

    const { runtimePaths, migration } = await prepareRuntimeStorage(appMock, runtimeRootDir);

    expect(migration).not.toBeNull();
    expect(migration?.chosen.label).toBe('legacy-1');
    expect(migration?.promotedToMain).toBe(true);

    const runtimeStats = databaseFixtures.get(runtimePaths.mainDbPath);
    expect(runtimeStats?.priceTickCount).toBe(5);
    expect(runtimeStats?.alertEventCount).toBe(3);

    expect(
      fs.existsSync(path.join(runtimePaths.sessionDataDir, 'Partitions', 'partition-state.txt')),
    ).toBe(true);
    expect(fs.existsSync(migration?.manifestPath ?? '')).toBe(true);
    expect(migration?.snapshots).toHaveLength(2);
    expect(appMock.setPath).toHaveBeenCalledWith('userData', path.win32.normalize(runtimeRootDir));
    expect(appMock.setPath).toHaveBeenCalledWith(
      'sessionData',
      path.win32.join(path.win32.normalize(runtimeRootDir), 'session-data'),
    );
  });

  it('seals the D-root main database after migration so later startups ignore legacy re-selection', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-storage-seal-'));
    tempDirs.push(tempRoot);

    const appDataDir = path.join(tempRoot, 'app-data');
    const runtimeRootDir = path.join(tempRoot, 'weather-runtime');
    const englishLegacyDir = path.join(appDataDir, 'Polymarket Weather Monitor');
    const chineseLegacyDir = path.join(appDataDir, '澶╂皵鐩戞帶');
    fs.mkdirSync(englishLegacyDir, { recursive: true });
    fs.mkdirSync(chineseLegacyDir, { recursive: true });

    seedLegacyDatabase(path.join(englishLegacyDir, 'polymarket-weather-monitor.sqlite'), {
      tickCount: 5,
      alertCount: 3,
      lastTickAt: 1_700_000_000_000,
      lastAlertAt: 1_700_000_100_000,
    });
    seedLegacyDatabase(path.join(chineseLegacyDir, 'polymarket-weather-monitor.sqlite'), {
      tickCount: 2,
      alertCount: 4,
      lastTickAt: 1_700_000_200_000,
      lastAlertAt: 1_700_000_300_000,
    });

    const appMock = {
      getPath: vi.fn((name: string) => {
        if (name === 'appData') {
          return appDataDir;
        }
        throw new Error(`Unsupported path request: ${name}`);
      }),
      setPath: vi.fn(),
      setAppLogsPath: vi.fn(),
    };

    const firstRun = await prepareRuntimeStorage(appMock, runtimeRootDir);
    expect(firstRun.migration?.chosen.label).toBe('legacy-1');
    expect(databaseFixtures.get(firstRun.runtimePaths.mainDbPath)?.priceTickCount).toBe(5);
    expect(fs.existsSync(path.join(runtimeRootDir, 'primary-storage.json'))).toBe(true);

    seedLegacyDatabase(path.join(chineseLegacyDir, 'polymarket-weather-monitor.sqlite'), {
      tickCount: 88,
      alertCount: 12,
      lastTickAt: 1_900_000_000_000,
      lastAlertAt: 1_900_000_100_000,
    });

    const secondRun = await prepareRuntimeStorage(appMock, runtimeRootDir);

    expect(secondRun.migration).toBeNull();
    expect(databaseFixtures.get(secondRun.runtimePaths.mainDbPath)?.priceTickCount).toBe(5);
    expect(databaseFixtures.get(secondRun.runtimePaths.mainDbPath)?.alertEventCount).toBe(3);
  });

  it('falls back to a readable legacy database when the sealed main database becomes unreadable', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-storage-corrupt-main-'));
    tempDirs.push(tempRoot);

    const appDataDir = path.join(tempRoot, 'app-data');
    const runtimeRootDir = path.join(tempRoot, 'weather-runtime');
    const runtimePaths = resolveRuntimePaths(runtimeRootDir);
    const englishLegacyDir = path.join(appDataDir, 'Polymarket Weather Monitor');
    fs.mkdirSync(englishLegacyDir, { recursive: true });

    seedLegacyDatabase(path.join(englishLegacyDir, 'polymarket-weather-monitor.sqlite'), {
      tickCount: 9,
      alertCount: 4,
      lastTickAt: 1_730_000_000_000,
      lastAlertAt: 1_730_000_100_000,
    });
    seedUnreadableDatabase(runtimePaths.mainDbPath);
    fs.writeFileSync(
      path.join(runtimeRootDir, 'primary-storage.json'),
      JSON.stringify({
        version: 1,
        sealedAt: '2026-04-24T00:00:00.000Z',
        mainDbPath: runtimePaths.mainDbPath,
        sourceDbPath: runtimePaths.mainDbPath,
        sourceName: 'runtime-main',
        manifestPath: null,
      }),
      'utf8',
    );

    const appMock = {
      getPath: vi.fn((name: string) => {
        if (name === 'appData') {
          return appDataDir;
        }
        throw new Error(`Unsupported path request: ${name}`);
      }),
      setPath: vi.fn(),
      setAppLogsPath: vi.fn(),
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { migration } = await prepareRuntimeStorage(appMock, runtimeRootDir);

    expect(migration).not.toBeNull();
    expect(migration?.chosen.label).toBe('legacy-1');
    expect(migration?.chosen.sourceName).toBe('Polymarket Weather Monitor');
    expect(migration?.promotedToMain).toBe(true);
    expect(migration?.candidates.map((candidate) => candidate.label)).toEqual(['legacy-1']);
    expect(migration?.snapshots).toHaveLength(1);
    expect(databaseFixtures.get(runtimePaths.mainDbPath)?.priceTickCount).toBe(9);
    expect(databaseFixtures.get(runtimePaths.mainDbPath)?.alertEventCount).toBe(4);
    expect(databaseOpenErrors.has(runtimePaths.mainDbPath)).toBe(false);

    const selection = JSON.parse(
      fs.readFileSync(path.join(runtimeRootDir, 'primary-storage.json'), 'utf8'),
    ) as {
      sourceDbPath: string | null;
      sourceName: string | null;
    };
    expect(selection.sourceDbPath).toBe(
      path.join(englishLegacyDir, 'polymarket-weather-monitor.sqlite'),
    );
    expect(selection.sourceName).toBe('Polymarket Weather Monitor');
  });

  it('skips unreadable legacy candidates while still promoting a valid fallback database', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-storage-corrupt-legacy-'));
    tempDirs.push(tempRoot);

    const appDataDir = path.join(tempRoot, 'app-data');
    const runtimeRootDir = path.join(tempRoot, 'weather-runtime');
    const unreadableLegacyDir = path.join(appDataDir, 'Polymarket Weather Monitor');
    const validLegacyDir = path.join(appDataDir, '天气监控');
    fs.mkdirSync(unreadableLegacyDir, { recursive: true });
    fs.mkdirSync(validLegacyDir, { recursive: true });

    seedUnreadableDatabase(path.join(unreadableLegacyDir, 'polymarket-weather-monitor.sqlite'));
    seedLegacyDatabase(path.join(validLegacyDir, 'polymarket-weather-monitor.sqlite'), {
      tickCount: 12,
      alertCount: 6,
      lastTickAt: 1_740_000_000_000,
      lastAlertAt: 1_740_000_100_000,
    });

    const appMock = {
      getPath: vi.fn((name: string) => {
        if (name === 'appData') {
          return appDataDir;
        }
        throw new Error(`Unsupported path request: ${name}`);
      }),
      setPath: vi.fn(),
      setAppLogsPath: vi.fn(),
    };
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { runtimePaths, migration } = await prepareRuntimeStorage(appMock, runtimeRootDir);

    expect(migration).not.toBeNull();
    expect(migration?.chosen.label).toBe('legacy-1');
    expect(migration?.chosen.sourceName).toBe('天气监控');
    expect(migration?.candidates.map((candidate) => candidate.sourceName)).toEqual(['天气监控']);
    expect(migration?.snapshots).toHaveLength(1);
    expect(databaseFixtures.get(runtimePaths.mainDbPath)?.priceTickCount).toBe(12);
    expect(databaseFixtures.get(runtimePaths.mainDbPath)?.alertEventCount).toBe(6);
  });

  it('copies missing session-data entries even when the target session directory is already partially populated', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-storage-session-'));
    tempDirs.push(tempRoot);

    const appDataDir = path.join(tempRoot, 'app-data');
    const runtimeRootDir = path.join(tempRoot, 'weather-runtime');
    const englishLegacyDir = path.join(appDataDir, 'Polymarket Weather Monitor');
    fs.mkdirSync(englishLegacyDir, { recursive: true });

    seedLegacyDatabase(path.join(englishLegacyDir, 'polymarket-weather-monitor.sqlite'), {
      tickCount: 5,
      alertCount: 3,
      lastTickAt: 1_700_000_000_000,
      lastAlertAt: 1_700_000_100_000,
    });

    fs.mkdirSync(path.join(englishLegacyDir, 'Partitions'), { recursive: true });
    fs.writeFileSync(
      path.join(englishLegacyDir, 'Partitions', 'partition-state.txt'),
      'session-state',
      'utf8',
    );
    fs.mkdirSync(path.join(englishLegacyDir, 'Local Storage'), { recursive: true });
    fs.writeFileSync(
      path.join(englishLegacyDir, 'Local Storage', 'legacy-leveldb.log'),
      'legacy',
      'utf8',
    );

    fs.mkdirSync(path.join(runtimeRootDir, 'session-data', 'Local Storage'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(runtimeRootDir, 'session-data', 'Local Storage', 'existing.log'),
      'runtime',
      'utf8',
    );

    const appMock = {
      getPath: vi.fn((name: string) => {
        if (name === 'appData') {
          return appDataDir;
        }
        throw new Error(`Unsupported path request: ${name}`);
      }),
      setPath: vi.fn(),
      setAppLogsPath: vi.fn(),
    };

    const { runtimePaths, migration } = await prepareRuntimeStorage(appMock, runtimeRootDir);

    expect(migration).not.toBeNull();
    expect(migration?.sessionData.copiedEntries).toEqual(['Partitions']);
    expect(migration?.sessionData.skipped).toBe(false);
    expect(
      fs.existsSync(path.join(runtimePaths.sessionDataDir, 'Partitions', 'partition-state.txt')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(runtimePaths.sessionDataDir, 'Local Storage', 'existing.log')),
    ).toBe(true);
  });

  it('inspects the current runtime main database summary', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-storage-summary-'));
    tempDirs.push(tempRoot);

    const runtimePaths = resolveRuntimePaths(tempRoot);
    const persistentSessionFile = path.join(
      runtimePaths.sessionDataDir,
      'Local Storage',
      'leveldb',
      'state.txt',
    );
    const logFile = path.join(runtimePaths.logsDir, 'runtime.log');
    seedLegacyDatabase(runtimePaths.mainDbPath, {
      tickCount: 42,
      alertCount: 9,
      lastTickAt: 1_710_000_000_000,
      lastAlertAt: 1_710_000_100_000,
    });
    fs.mkdirSync(path.dirname(persistentSessionFile), { recursive: true });
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(persistentSessionFile, 'persisted-session', 'utf8');
    fs.writeFileSync(logFile, 'runtime-log', 'utf8');

    const summary = inspectRuntimeStorageSummary(runtimePaths);

    expect(summary.dataRootDir).toBe(path.win32.normalize(tempRoot));
    expect(summary.mainDbPath).toBe(runtimePaths.mainDbPath);
    expect(summary.mainDbExists).toBe(true);
    expect(summary.mainDbSizeBytes).toBeGreaterThan(0);
    expect(summary.totalSizeBytes).toBeGreaterThan(0);
    expect(summary.databaseSizeBytes).toBeGreaterThan(0);
    expect(summary.archiveSizeBytes).toBe(0);
    expect(summary.backupSizeBytes).toBe(0);
    expect(summary.archiveFileCount).toBe(0);
    expect(summary.backupFileCount).toBe(0);
    expect(summary.cleanableSizeBytes).toBe(0);
    expect(summary.cleanableEntryCount).toBe(0);
    expect(summary.canClearCache).toBe(false);
    expect(summary.lastCleanupAt).toBeNull();
    expect(summary.sessionPersistentSizeBytes).toBeGreaterThan(0);
    expect(summary.logFileCount).toBe(1);
    expect(summary.latestLogAt).not.toBeNull();
    expect(summary.priceTickCount).toBe(42);
    expect(summary.alertEventCount).toBe(9);
    expect(summary.latestPriceTickAt).toBe(new Date(1_710_000_000_000).toISOString());
    expect(summary.latestAlertAt).toBe(new Date(1_710_000_100_000).toISOString());
    expect(summary.lastActivityAt).toBe(new Date(1_710_000_100_000).toISOString());
    expect(summary.backupDir).toBe(path.win32.join(path.win32.normalize(tempRoot), 'backup'));
    expect(summary.latestMainBackupPath).toBeNull();
    expect(summary.latestMainBackupAt).toBeNull();
    expect(summary.latestBackupPath).toBeNull();
    expect(summary.latestBackupAt).toBeNull();
  });

  it('scans the backup directory and reports the latest main database backup', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-storage-latest-backup-'));
    tempDirs.push(tempRoot);

    const runtimePaths = resolveRuntimePaths(tempRoot);
    fs.mkdirSync(runtimePaths.backupDir, { recursive: true });

    const olderBackupPath = path.join(runtimePaths.backupDir, 'main-backup-20260424-010000.sqlite');
    const latestBackupPath = path.join(runtimePaths.backupDir, 'main-backup-20260424-020000.sqlite');
    const ignoredPath = path.join(runtimePaths.backupDir, 'db-migration-20260424', 'runtime-main.sqlite');

    fs.writeFileSync(olderBackupPath, 'older-backup', 'utf8');
    fs.writeFileSync(latestBackupPath, 'latest-backup', 'utf8');
    fs.mkdirSync(path.dirname(ignoredPath), { recursive: true });
    fs.writeFileSync(ignoredPath, 'migration-snapshot', 'utf8');

    fs.utimesSync(olderBackupPath, new Date('2026-04-24T01:00:00.000Z'), new Date('2026-04-24T01:00:00.000Z'));
    fs.utimesSync(latestBackupPath, new Date('2026-04-24T02:00:00.000Z'), new Date('2026-04-24T02:00:00.000Z'));

    const latestBackup = inspectLatestMainDatabaseBackup(runtimePaths.backupDir);
    const summary = inspectRuntimeStorageSummary(runtimePaths);

    expect(latestBackup.backupPath).toBe(path.win32.normalize(latestBackupPath));
    expect(latestBackup.backupAt).toBe(new Date('2026-04-24T02:00:00.000Z').toISOString());
    expect(summary.latestMainBackupPath).toBe(path.win32.normalize(latestBackupPath));
    expect(summary.latestMainBackupAt).toBe(new Date('2026-04-24T02:00:00.000Z').toISOString());
    expect(summary.latestBackupPath).toBe(path.win32.normalize(latestBackupPath));
    expect(summary.latestBackupAt).toBe(new Date('2026-04-24T02:00:00.000Z').toISOString());
    expect(summary.backupFileCount).toBe(3);
  });

  it('creates a manual backup of the runtime main database under the backup directory', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-storage-backup-'));
    tempDirs.push(tempRoot);

    const runtimePaths = resolveRuntimePaths(tempRoot);
    seedLegacyDatabase(runtimePaths.mainDbPath, {
      tickCount: 17,
      alertCount: 6,
      lastTickAt: 1_720_000_000_000,
      lastAlertAt: 1_720_000_100_000,
    });

    const result = await createRuntimeStorageBackup(runtimePaths);

    expect(result.backupPath.startsWith(runtimePaths.backupDir)).toBe(true);
    expect(result.backupPath.endsWith('.sqlite')).toBe(true);
    expect(fs.existsSync(result.backupPath)).toBe(true);
    expect(databaseFixtures.get(result.backupPath)).toEqual(databaseFixtures.get(runtimePaths.mainDbPath));
    expect(result.storageSummary.mainDbPath).toBe(runtimePaths.mainDbPath);
    expect(result.storageSummary.backupDir).toBe(runtimePaths.backupDir);
    expect(result.storageSummary.latestMainBackupPath).toBe(result.backupPath);
    expect(result.storageSummary.latestMainBackupAt).not.toBeNull();
    expect(result.storageSummary.latestBackupPath).toBe(result.backupPath);
    expect(result.storageSummary.latestBackupAt).not.toBeNull();
  });

  it('clears only whitelisted session cache entries and preserves the database, backups, and persistent session data', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-storage-clear-cache-'));
    tempDirs.push(tempRoot);

    const runtimePaths = resolveRuntimePaths(tempRoot);
    seedLegacyDatabase(runtimePaths.mainDbPath, {
      tickCount: 8,
      alertCount: 2,
      lastTickAt: 1_725_000_000_000,
      lastAlertAt: 1_725_000_100_000,
    });
    fs.mkdirSync(runtimePaths.backupDir, { recursive: true });
    fs.mkdirSync(runtimePaths.archiveDir, { recursive: true });
    fs.writeFileSync(path.join(runtimePaths.backupDir, 'manual.sqlite'), 'backup', 'utf8');
    fs.writeFileSync(path.join(runtimePaths.archiveDir, 'price-ticks-2026-04.sqlite'), 'archive', 'utf8');

    const codeCacheFile = path.join(runtimePaths.sessionDataDir, 'Code Cache', 'cache.bin');
    const gpuCacheFile = path.join(runtimePaths.sessionDataDir, 'GPUCache', 'gpu.bin');
    const partitionCacheFile = path.join(
      runtimePaths.sessionDataDir,
      'Partitions',
      'persist-weather',
      'Network',
      'network.bin',
    );
    const cookiesFile = path.join(runtimePaths.sessionDataDir, 'Cookies');
    const localStorageFile = path.join(
      runtimePaths.sessionDataDir,
      'Local Storage',
      'leveldb',
      'state.txt',
    );

    fs.mkdirSync(path.dirname(codeCacheFile), { recursive: true });
    fs.mkdirSync(path.dirname(gpuCacheFile), { recursive: true });
    fs.mkdirSync(path.dirname(partitionCacheFile), { recursive: true });
    fs.mkdirSync(path.dirname(localStorageFile), { recursive: true });
    fs.writeFileSync(codeCacheFile, 'cache', 'utf8');
    fs.writeFileSync(gpuCacheFile, 'gpu', 'utf8');
    fs.writeFileSync(partitionCacheFile, 'network', 'utf8');
    fs.writeFileSync(cookiesFile, 'cookie-state', 'utf8');
    fs.writeFileSync(localStorageFile, 'persisted', 'utf8');

    const result = await clearRuntimeStorageCache(runtimePaths);

    expect(result.reclaimedBytes).toBeGreaterThan(0);
    expect(result.deletedEntries).toEqual(['Code Cache', 'GPUCache', 'Partitions/persist-weather/Network']);
    expect(fs.existsSync(runtimePaths.mainDbPath)).toBe(true);
    expect(fs.existsSync(path.join(runtimePaths.backupDir, 'manual.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(runtimePaths.archiveDir, 'price-ticks-2026-04.sqlite'))).toBe(true);
    expect(fs.existsSync(codeCacheFile)).toBe(false);
    expect(fs.existsSync(gpuCacheFile)).toBe(false);
    expect(fs.existsSync(partitionCacheFile)).toBe(false);
    expect(fs.existsSync(cookiesFile)).toBe(true);
    expect(fs.existsSync(localStorageFile)).toBe(true);
    expect(result.storageSummary.cleanableSizeBytes).toBe(0);
    expect(result.storageSummary.cleanableEntryCount).toBe(0);
    expect(result.storageSummary.canClearCache).toBe(false);
    expect(result.storageSummary.lastCleanupAt).not.toBeNull();
    expect(result.storageSummary.sessionPersistentSizeBytes).toBeGreaterThan(0);
  });
});

interface SeedLegacyDatabaseInput {
  tickCount: number;
  alertCount: number;
  lastTickAt: number;
  lastAlertAt: number;
}

const seedLegacyDatabase = (dbPath: string, input: SeedLegacyDatabaseInput): void => {
  const fixture: DatabaseFixture = {
    priceTickCount: input.tickCount,
    alertEventCount: input.alertCount,
    latestPriceTickAt: input.lastTickAt,
    latestAlertAt: input.lastAlertAt,
    latestStateUpdateAt: null,
    latestSettingUpdateAt: input.lastAlertAt,
  };
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(fixture), 'utf8');
  databaseFixtures.set(dbPath, fixture);
};

const seedUnreadableDatabase = (dbPath: string): void => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, 'corrupt-database', 'utf8');
  databaseFixtures.delete(dbPath);
  databaseOpenErrors.set(dbPath, 'database disk image is malformed');
};

const resolveQuery = (dbPath: string, sql: string, tableName?: string) => {
  const fixture = databaseFixtures.get(dbPath);
  if (!fixture) {
    throw new Error(`Missing database fixture for ${dbPath}`);
  }

  const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalizedSql.includes("from sqlite_master")) {
    if (
      tableName === 'price_ticks' ||
      tableName === 'alert_events' ||
      tableName === 'latest_token_state' ||
      tableName === 'app_settings'
    ) {
      return { exists: 1 };
    }
    return undefined;
  }
  if (normalizedSql.includes('count(*) as value from price_ticks')) {
    return { value: fixture.priceTickCount };
  }
  if (normalizedSql.includes('count(*) as value from alert_events')) {
    return { value: fixture.alertEventCount };
  }
  if (normalizedSql.includes('max(timestamp) as value from price_ticks')) {
    return { value: fixture.latestPriceTickAt };
  }
  if (normalizedSql.includes('max(triggered_at) as value from alert_events')) {
    return { value: fixture.latestAlertAt };
  }
  if (normalizedSql.includes('max(updated_at) as value from latest_token_state')) {
    return { value: fixture.latestStateUpdateAt };
  }
  if (normalizedSql.includes('max(updated_at) as value from app_settings')) {
    return { value: fixture.latestSettingUpdateAt };
  }

  throw new Error(`Unsupported SQL in test double: ${sql}`);
};
