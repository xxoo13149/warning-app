import type { App } from 'electron';

import { configureRuntimePaths } from './runtime-paths';
import {
  choosePrimaryDatabase,
  inspectLatestMainDatabaseBackup,
} from './runtime-storage/database';
import { migrateRuntimeStorage } from './runtime-storage/migration';
import {
  clearRuntimeStorageCache,
  createRuntimeStorageBackup,
  inspectRuntimeStorageSummary,
} from './runtime-storage/operations';
import { resolveLegacyUserDataDirs } from './runtime-storage/shared';
import type { RuntimeStoragePreparation } from './runtime-storage/types';

export type {
  DatabaseCandidate,
  DatabaseCandidateStats,
  DatabaseSnapshot,
  RuntimeStorageMigrationReport,
  RuntimeStoragePreparation,
  SessionDataMigration,
} from './runtime-storage/types';

type RuntimeStorageApp = Pick<App, 'getPath' | 'setPath' | 'setAppLogsPath'>;

export {
  choosePrimaryDatabase,
  clearRuntimeStorageCache,
  createRuntimeStorageBackup,
  inspectLatestMainDatabaseBackup,
  inspectRuntimeStorageSummary,
  resolveLegacyUserDataDirs,
};

export const prepareRuntimeStorage = async (
  electronApp: RuntimeStorageApp,
  dataRootDir?: string,
): Promise<RuntimeStoragePreparation> => {
  const runtimePaths = configureRuntimePaths(electronApp, dataRootDir);
  const legacyUserDataDirs = resolveLegacyUserDataDirs(electronApp.getPath('appData'));
  const migration = await migrateRuntimeStorage({
    runtimePaths,
    legacyUserDataDirs,
  });

  return {
    runtimePaths,
    migration,
  };
};
