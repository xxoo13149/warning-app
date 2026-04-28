import type { RuntimePaths } from '../runtime-paths';

export type DatabaseCandidateKind = 'runtime-main' | 'legacy';

export interface RuntimeCacheCleanupRecord {
  version: 1;
  cleanedAt: string;
}

export interface DatabaseCandidateStats {
  fileSizeBytes: number;
  priceTickCount: number;
  alertEventCount: number;
  latestPriceTickAt: number | null;
  latestAlertAt: number | null;
  latestStateUpdateAt: number | null;
  latestSettingUpdateAt: number | null;
  lastActivityAt: number | null;
}

export const EMPTY_DATABASE_CANDIDATE_STATS: DatabaseCandidateStats = {
  fileSizeBytes: 0,
  priceTickCount: 0,
  alertEventCount: 0,
  latestPriceTickAt: null,
  latestAlertAt: null,
  latestStateUpdateAt: null,
  latestSettingUpdateAt: null,
  lastActivityAt: null,
};

export interface DatabaseCandidate {
  kind: DatabaseCandidateKind;
  label: string;
  sourceName: string;
  dbPath: string;
  userDataDir: string;
  stats: DatabaseCandidateStats;
}

export interface DatabaseSnapshot {
  label: string;
  sourcePath: string;
  snapshotPath: string;
}

export interface SessionDataMigration {
  sourceUserDataDir: string | null;
  copiedEntries: string[];
  skipped: boolean;
}

export interface RuntimeStorageMigrationReport {
  generatedAt: string;
  runtimePaths: RuntimePaths;
  chosen: Pick<DatabaseCandidate, 'kind' | 'label' | 'sourceName' | 'dbPath'>;
  promotedToMain: boolean;
  manifestPath: string;
  candidates: DatabaseCandidate[];
  snapshots: DatabaseSnapshot[];
  sessionData: SessionDataMigration;
}

export interface RuntimeStoragePreparation {
  runtimePaths: RuntimePaths;
  migration: RuntimeStorageMigrationReport | null;
}

export interface RuntimeStoragePrimarySelection {
  version: 1;
  sealedAt: string;
  mainDbPath: string;
  sourceDbPath: string | null;
  sourceName: string | null;
  manifestPath: string | null;
}

export interface PathFootprint {
  sizeBytes: number;
  fileCount: number;
  latestUpdatedAt: number | null;
}

export interface MigrateRuntimeStorageOptions {
  runtimePaths: RuntimePaths;
  legacyUserDataDirs: string[];
}

export interface BuildDatabaseCandidateInput {
  kind: DatabaseCandidateKind;
  label: string;
  sourceName: string;
  dbPath: string;
  userDataDir: string;
}

export interface CopyLegacySessionDataOptions {
  sourceUserDataDir: string | null;
  targetSessionDataDir: string;
}
