import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configureRuntimePaths,
  FIXED_RUNTIME_DATA_ROOT,
  resolveRuntimePaths,
} from '../../src/main/services/runtime-paths';

describe('configureRuntimePaths', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const directoryPath of tempDirs.splice(0)) {
      fs.rmSync(directoryPath, { recursive: true, force: true });
    }
  });

  it('pins userData, sessionData, and logs under the configured data root', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-paths-'));
    tempDirs.push(tempRoot);
    const dataRootDir = path.join(tempRoot, 'weather-runtime');
    const appMock = {
      setPath: vi.fn(),
      setAppLogsPath: vi.fn(),
    };

    const runtimePaths = configureRuntimePaths(appMock, dataRootDir);

    expect(runtimePaths.dataRootDir).toBe(path.win32.normalize(dataRootDir));
    expect(appMock.setPath).toHaveBeenNthCalledWith(1, 'userData', runtimePaths.dataRootDir);
    expect(appMock.setPath).toHaveBeenNthCalledWith(
      2,
      'sessionData',
      runtimePaths.sessionDataDir,
    );
    expect(appMock.setAppLogsPath).toHaveBeenCalledWith(runtimePaths.logsDir);
    expect(fs.existsSync(runtimePaths.dbDir)).toBe(true);
    expect(fs.existsSync(runtimePaths.archiveDir)).toBe(true);
    expect(fs.existsSync(runtimePaths.backupDir)).toBe(true);
    expect(fs.existsSync(runtimePaths.sessionDataDir)).toBe(true);
    expect(fs.existsSync(runtimePaths.logsDir)).toBe(true);
  });

  it('defaults the runtime root to the fixed D-drive data directory', () => {
    const runtimePaths = resolveRuntimePaths();

    expect(runtimePaths.dataRootDir).toBe(path.win32.normalize(FIXED_RUNTIME_DATA_ROOT));
    expect(runtimePaths.mainDbPath).toBe(
      path.win32.join(path.win32.normalize(FIXED_RUNTIME_DATA_ROOT), 'db', 'main.sqlite'),
    );
    expect(runtimePaths.sessionDataDir).toBe(
      path.win32.join(path.win32.normalize(FIXED_RUNTIME_DATA_ROOT), 'session-data'),
    );
  });
});
