import fs from 'node:fs';
import path from 'node:path';

import type {
  RuntimeDiagnosticsLogFile,
  RuntimeDiagnosticsPackage,
  RuntimeDiagnosticsPackageResult,
} from '../../shared/monitor-contracts';
import type { RuntimePaths } from './runtime-paths';
import { inspectRuntimeStorageSummary } from './runtime-storage';

export interface RuntimeDiagnosticsOptions {
  outputDir?: string;
  now?: () => Date;
  logFileLimit?: number;
  logTailBytes?: number;
}

const DEFAULT_LOG_FILE_LIMIT = 5;
const DEFAULT_LOG_TAIL_BYTES = 16 * 1024;

export const createRuntimeDiagnosticsPackage = (
  runtimePaths: RuntimePaths,
  options: RuntimeDiagnosticsOptions = {},
): RuntimeDiagnosticsPackageResult => {
  const now = options.now?.() ?? new Date();
  const outputDir = options.outputDir ?? path.join(runtimePaths.dataRootDir, 'diagnostics');
  const logFileLimit = normalizePositiveInteger(options.logFileLimit, DEFAULT_LOG_FILE_LIMIT);
  const logTailBytes = normalizePositiveInteger(options.logTailBytes, DEFAULT_LOG_TAIL_BYTES);

  fs.mkdirSync(outputDir, { recursive: true });

  const diagnostics: RuntimeDiagnosticsPackage = {
    version: 1,
    generatedAt: now.toISOString(),
    runtimePaths,
    storageSummary: inspectRuntimeStorageSummary(runtimePaths),
    process: {
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron ?? null,
    },
    logs: collectRuntimeLogs(runtimePaths.logsDir, logFileLimit, logTailBytes),
    privacy: {
      format: 'json',
      excludes: [
        'main.sqlite contents',
        'sqlite sidecar contents',
        'archive sqlite contents',
        'backup sqlite contents',
        'session data contents',
      ],
    },
  };

  const packagePath = resolveDiagnosticsPackagePath(outputDir, now);
  fs.writeFileSync(packagePath, JSON.stringify(diagnostics, null, 2), 'utf8');

  return {
    packagePath,
    diagnostics,
  };
};

const collectRuntimeLogs = (
  logsDir: string,
  fileLimit: number,
  tailBytes: number,
): RuntimeDiagnosticsPackage['logs'] => {
  const allFiles = collectFilesRecursively(logsDir);
  const files = allFiles
    .sort(compareLogFiles)
    .slice(0, fileLimit)
    .map((filePath) => readLogFileTail(logsDir, filePath, tailBytes));

  return {
    directory: logsDir,
    fileCount: allFiles.length,
    includedFileCount: files.length,
    tailBytes,
    files,
  };
};

const collectFilesRecursively = (directoryPath: string): string[] => {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  const stats = fs.statSync(directoryPath);
  if (stats.isFile()) {
    return [directoryPath];
  }
  if (!stats.isDirectory()) {
    return [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isFile()) {
      files.push(entryPath);
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...collectFilesRecursively(entryPath));
    }
  }
  return files;
};

const compareLogFiles = (leftPath: string, rightPath: string): number => {
  const leftStats = fs.statSync(leftPath);
  const rightStats = fs.statSync(rightPath);
  if (rightStats.mtimeMs !== leftStats.mtimeMs) {
    return rightStats.mtimeMs - leftStats.mtimeMs;
  }
  return leftPath.localeCompare(rightPath);
};

const readLogFileTail = (
  logsDir: string,
  filePath: string,
  maxBytes: number,
): RuntimeDiagnosticsLogFile => {
  const stats = fs.statSync(filePath);
  const tailBytes = Math.min(stats.size, maxBytes);
  const buffer = Buffer.alloc(tailBytes);
  const fileHandle = fs.openSync(filePath, 'r');

  try {
    fs.readSync(fileHandle, buffer, 0, tailBytes, Math.max(0, stats.size - tailBytes));
  } finally {
    fs.closeSync(fileHandle);
  }

  return {
    path: filePath,
    relativePath: toPortableRelativePath(logsDir, filePath),
    sizeBytes: stats.size,
    modifiedAt: Number.isFinite(stats.mtimeMs) ? new Date(stats.mtimeMs).toISOString() : null,
    tail: buffer.toString('utf8'),
    tailBytes,
    truncated: stats.size > tailBytes,
  };
};

const resolveDiagnosticsPackagePath = (outputDir: string, generatedAt: Date): string => {
  const basePath = path.join(outputDir, `runtime-diagnostics-${createTimestampTag(generatedAt)}`);
  let packagePath = `${basePath}.json`;
  let suffix = 1;

  while (fs.existsSync(packagePath)) {
    packagePath = `${basePath}-${suffix}.json`;
    suffix += 1;
  }

  return packagePath;
};

const createTimestampTag = (value: Date): string =>
  [
    value.getUTCFullYear().toString().padStart(4, '0'),
    (value.getUTCMonth() + 1).toString().padStart(2, '0'),
    value.getUTCDate().toString().padStart(2, '0'),
    '-',
    value.getUTCHours().toString().padStart(2, '0'),
    value.getUTCMinutes().toString().padStart(2, '0'),
    value.getUTCSeconds().toString().padStart(2, '0'),
  ].join('');

const normalizePositiveInteger = (value: number | undefined, fallback: number): number => {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
};

const toPortableRelativePath = (rootPath: string, filePath: string): string => {
  const relativePath = path.relative(rootPath, filePath);
  return relativePath ? relativePath.replace(/\\/g, '/') : path.basename(filePath);
};
