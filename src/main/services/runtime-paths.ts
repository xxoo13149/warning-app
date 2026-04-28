import type { App } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export const FIXED_RUNTIME_DATA_ROOT = 'D:\\\u5929\u6c14\u76d1\u63a7-data';
export const RUNTIME_MAIN_DB_FILENAME = 'main.sqlite';

export interface RuntimePaths {
  dataRootDir: string;
  dbDir: string;
  mainDbPath: string;
  archiveDir: string;
  backupDir: string;
  sessionDataDir: string;
  logsDir: string;
}

const buildWindowsPath = (...segments: string[]): string => path.win32.join(...segments);

export const resolveRuntimePaths = (
  dataRootDir: string = FIXED_RUNTIME_DATA_ROOT,
): RuntimePaths => {
  const normalizedDataRootDir = path.win32.normalize(dataRootDir);
  const dbDir = buildWindowsPath(normalizedDataRootDir, 'db');

  return {
    dataRootDir: normalizedDataRootDir,
    dbDir,
    mainDbPath: buildWindowsPath(dbDir, RUNTIME_MAIN_DB_FILENAME),
    archiveDir: buildWindowsPath(dbDir, 'archive'),
    backupDir: buildWindowsPath(normalizedDataRootDir, 'backup'),
    sessionDataDir: buildWindowsPath(normalizedDataRootDir, 'session-data'),
    logsDir: buildWindowsPath(normalizedDataRootDir, 'logs'),
  };
};

const listRuntimeDirectories = (runtimePaths: RuntimePaths): string[] => [
  runtimePaths.dataRootDir,
  runtimePaths.dbDir,
  runtimePaths.archiveDir,
  runtimePaths.backupDir,
  runtimePaths.sessionDataDir,
  runtimePaths.logsDir,
];

export const ensureRuntimeDirectories = (runtimePaths: RuntimePaths): void => {
  for (const directoryPath of listRuntimeDirectories(runtimePaths)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
};

export const configureRuntimePaths = (
  electronApp: Pick<App, 'setPath' | 'setAppLogsPath'>,
  dataRootDir?: string,
): RuntimePaths => {
  const runtimePaths = resolveRuntimePaths(dataRootDir);

  ensureRuntimeDirectories(runtimePaths);
  electronApp.setPath('userData', runtimePaths.dataRootDir);
  electronApp.setPath('sessionData', runtimePaths.sessionDataDir);
  electronApp.setAppLogsPath(runtimePaths.logsDir);

  return runtimePaths;
};
