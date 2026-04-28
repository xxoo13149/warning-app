import fs from 'node:fs';
import path from 'node:path';

import type {
  BuildDatabaseCandidateInput,
  CopyLegacySessionDataOptions,
  DatabaseCandidate,
  MigrateRuntimeStorageOptions,
  RuntimeStorageMigrationReport,
  SessionDataMigration,
} from './types';
import {
  LEGACY_DB_FILENAME,
  copyableSessionDataEntryNames,
  createTimestampTag,
  readPrimarySelection,
  writePrimarySelection,
} from './shared';
import { backupDatabase, choosePrimaryDatabase, inspectDatabaseSafely } from './database';

export const migrateRuntimeStorage = async (
  options: MigrateRuntimeStorageOptions,
): Promise<RuntimeStorageMigrationReport | null> => {
  const existingSelection = readPrimarySelection(options.runtimePaths);
  const candidates = collectDatabaseCandidates(options.runtimePaths, options.legacyUserDataDirs);
  const runtimeMainCandidate = candidates.find((candidate) => candidate.kind === 'runtime-main');

  if (existingSelection && runtimeMainCandidate) {
    return null;
  }

  const hasLegacyCandidate = candidates.some((candidate) => candidate.kind === 'legacy');
  if (!hasLegacyCandidate) {
    writePrimarySelection(options.runtimePaths, null, null);
    return null;
  }

  const chosen = choosePrimaryDatabase(candidates);
  if (!chosen) {
    return null;
  }

  const migrationDir = path.join(
    options.runtimePaths.backupDir,
    `db-migration-${createTimestampTag(new Date())}`,
  );
  fs.mkdirSync(migrationDir, { recursive: true });

  const snapshots = [];
  for (const candidate of candidates) {
    const snapshotPath = path.join(migrationDir, `${candidate.label}.sqlite`);
    await backupDatabase(candidate.dbPath, snapshotPath);
    snapshots.push({
      label: candidate.label,
      sourcePath: candidate.dbPath,
      snapshotPath,
    });
  }

  const promotedToMain = chosen.dbPath !== options.runtimePaths.mainDbPath;
  if (promotedToMain) {
    await backupDatabase(chosen.dbPath, options.runtimePaths.mainDbPath);
  }

  const sessionData = copyLegacySessionData({
    sourceUserDataDir: chosen.kind === 'legacy' ? chosen.userDataDir : null,
    targetSessionDataDir: options.runtimePaths.sessionDataDir,
  });

  const manifestPath = path.join(migrationDir, 'manifest.json');
  const report: RuntimeStorageMigrationReport = {
    generatedAt: new Date().toISOString(),
    runtimePaths: options.runtimePaths,
    chosen: {
      kind: chosen.kind,
      label: chosen.label,
      sourceName: chosen.sourceName,
      dbPath: chosen.dbPath,
    },
    promotedToMain,
    manifestPath,
    candidates,
    snapshots,
    sessionData,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(report, null, 2), 'utf8');
  writePrimarySelection(options.runtimePaths, chosen, manifestPath);

  return report;
};

const collectDatabaseCandidates = (
  runtimePaths: MigrateRuntimeStorageOptions['runtimePaths'],
  legacyUserDataDirs: readonly string[],
): DatabaseCandidate[] => {
  const candidates: DatabaseCandidate[] = [];

  if (fs.existsSync(runtimePaths.mainDbPath)) {
    const runtimeCandidate = buildDatabaseCandidate({
      kind: 'runtime-main',
      label: 'runtime-main',
      sourceName: 'runtime-main',
      dbPath: runtimePaths.mainDbPath,
      userDataDir: runtimePaths.dataRootDir,
    });
    if (runtimeCandidate) {
      candidates.push(runtimeCandidate);
    }
  }

  let legacyIndex = 0;
  for (const userDataDir of legacyUserDataDirs) {
    const dbPath = path.join(userDataDir, LEGACY_DB_FILENAME);
    if (!fs.existsSync(dbPath)) {
      continue;
    }

    const legacyCandidate = buildDatabaseCandidate({
      kind: 'legacy',
      label: `legacy-${legacyIndex + 1}`,
      sourceName: path.basename(userDataDir),
      dbPath,
      userDataDir,
    });
    if (!legacyCandidate) {
      continue;
    }

    legacyIndex += 1;
    candidates.push(legacyCandidate);
  }

  return candidates;
};

const buildDatabaseCandidate = (
  input: BuildDatabaseCandidateInput,
): DatabaseCandidate | null => {
  const stats = inspectDatabaseSafely(input.dbPath);
  if (!stats) {
    return null;
  }

  return {
    ...input,
    stats,
  };
};

const copyLegacySessionData = (
  options: CopyLegacySessionDataOptions,
): SessionDataMigration => {
  if (!options.sourceUserDataDir) {
    return {
      sourceUserDataDir: null,
      copiedEntries: [],
      skipped: true,
    };
  }

  const copiedEntries: string[] = [];
  for (const entryName of copyableSessionDataEntryNames()) {
    const sourcePath = path.join(options.sourceUserDataDir, entryName);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    const targetPath = path.join(options.targetSessionDataDir, entryName);
    if (fs.existsSync(targetPath)) {
      continue;
    }
    fs.cpSync(sourcePath, targetPath, {
      recursive: true,
      force: false,
    });
    copiedEntries.push(entryName);
  }

  return {
    sourceUserDataDir: options.sourceUserDataDir,
    copiedEntries,
    skipped: copiedEntries.length === 0,
  };
};
