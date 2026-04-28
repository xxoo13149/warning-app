import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const jiti = createJiti(import.meta.url, { moduleCache: false });
const tempDirs = [];
const originalResourcesPath = process.resourcesPath;

const {
  configureRuntimePaths,
} = await jiti.import('./../src/main/services/runtime-paths.ts');
const { WeatherMonitorRepository } = await jiti.import('./../src/core/db/repository.ts');
const { CoreWorkerClient } = await jiti.import('./../src/main/services/core-worker-client.ts');

const createTempDir = (prefix) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
};

const setResourcesPath = (value) => {
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value,
  });
};

const restoreResourcesPath = () => {
  if (originalResourcesPath === undefined) {
    Reflect.deleteProperty(process, 'resourcesPath');
    return;
  }
  setResourcesPath(originalResourcesPath);
};

const cleanup = () => {
  restoreResourcesPath();
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

const runScenario = async (label, execute) => {
  process.stdout.write(`[startup-smoke] ${label} ... `);
  await execute();
  process.stdout.write('ok\n');
};

const verifyIsolatedRuntimeDbBootstrap = async () => {
  const runtimeRoot = path.join(createTempDir('startup-smoke-runtime-'), 'runtime-data');
  const calls = [];
  const appMock = {
    setPath: (name, value) => {
      calls.push(['setPath', name, value]);
    },
    setAppLogsPath: (value) => {
      calls.push(['setAppLogsPath', value]);
    },
  };

  const runtimePaths = configureRuntimePaths(appMock, runtimeRoot);
  const repository = new WeatherMonitorRepository({
    dbPath: runtimePaths.mainDbPath,
    archiveDir: runtimePaths.archiveDir,
  });

  try {
    repository.init();
    repository.seedDefaults();
    assert.equal(fs.existsSync(runtimePaths.mainDbPath), true);
    assert.equal(repository.queryAppSetting('tickRetentionDays')?.value !== undefined, true);
    assert.equal(repository.queryAppSetting('alertRetentionDays')?.value !== undefined, true);
    assert.deepEqual(calls[0], ['setPath', 'userData', runtimePaths.dataRootDir]);
    assert.deepEqual(calls[1], ['setPath', 'sessionData', runtimePaths.sessionDataDir]);
    assert.deepEqual(calls[2], ['setAppLogsPath', runtimePaths.logsDir]);
  } finally {
    repository.close();
  }
};

const verifyRuntimePathFailureDoesNotTouchAppState = async () => {
  const failingRoot = 'D:\\startup-smoke-denied';
  const appCalls = [];
  const appMock = {
    setPath: (name, value) => {
      appCalls.push(['setPath', name, value]);
    },
    setAppLogsPath: (value) => {
      appCalls.push(['setAppLogsPath', value]);
    },
  };
  const originalMkdirSync = fs.mkdirSync;

  fs.mkdirSync = function patchedMkdirSync(candidatePath, options) {
    const normalizedPath = path.win32.normalize(String(candidatePath));
    if (normalizedPath.startsWith(path.win32.normalize(failingRoot))) {
      const error = new Error(`EACCES: permission denied, mkdir '${normalizedPath}'`);
      error.code = 'EACCES';
      throw error;
    }
    return originalMkdirSync.call(fs, candidatePath, options);
  };

  try {
    assert.throws(
      () => configureRuntimePaths(appMock, failingRoot),
      /EACCES: permission denied, mkdir 'D:\\startup-smoke-denied/,
    );
    assert.equal(appCalls.length, 0);
  } finally {
    fs.mkdirSync = originalMkdirSync;
  }
};

const verifyPackagedWorkerMissingIsSurfaced = async () => {
  const resourcesPath = createTempDir('startup-smoke-missing-worker-');
  const originalExistsSync = fs.existsSync;
  const client = new CoreWorkerClient({
    dbPath: 'D:\\runtime-data\\db\\main.sqlite',
    proxyUrl: null,
    builtinSoundDir: 'C:\\sounds',
  });
  const errors = [];

  setResourcesPath(resourcesPath);
  fs.existsSync = function patchedExistsSync(candidatePath) {
    if (String(candidatePath).endsWith('worker.js')) {
      return false;
    }
    return originalExistsSync.call(fs, candidatePath);
  };
  client.on('error', (error) => {
    errors.push(error);
  });

  try {
    client.start();
    const health = await client.invoke('app.getHealth');
    assert.equal(client.isRunning(), false);
    assert.equal(errors.length, 1);
    assert.match(errors[0]?.message ?? '', /Core worker entry not found\. Checked:/);
    assert.equal(health.workerRunning, false);
    assert.equal(health.errorSource, 'packaging');
    assert.match(health.serviceStatus.lastError ?? '', /packaged-asar/);
  } finally {
    fs.existsSync = originalExistsSync;
  }
};

const verifyPackagedWorkerLaunchesFromResources = async () => {
  const resourcesPath = createTempDir('startup-smoke-packaged-worker-');
  const unpackedWorkerPath = path.join(
    resourcesPath,
    'app.asar.unpacked',
    '.vite',
    'build',
    'worker.js',
  );
  const asarWorkerPath = path.join(resourcesPath, 'app.asar', '.vite', 'build', 'worker.js');
  const createWorkerSource = (diagnostic) => `
const { parentPort } = require('node:worker_threads');

const healthPayload = {
  connected: false,
  mode: 'degraded',
  shardActive: 0,
  shardTotal: 0,
  subscribedTokens: 0,
  reconnects: 0,
  latencyMs: 0,
  droppedEvents: 0,
  lastSyncAt: new Date().toISOString(),
  workerRunning: true,
  startupPhase: 'degraded',
  diagnostic: '${diagnostic}',
  errorSource: 'worker',
  serviceStatus: {
    coreWorker: 'running',
    discovery: 'idle',
    websocket: 'disconnected',
    dataFreshness: 'unknown',
    activeShards: 0,
    totalShards: 0,
    lagMs: 0,
    lastUpdateAt: new Date().toISOString(),
    lastError: null,
    lastErrorSource: null,
  },
};

parentPort.on('message', (message) => {
  if (!message || message.kind !== 'request') {
    return;
  }

  if (message.channel === 'app.getHealth') {
    parentPort.postMessage({
      kind: 'response',
      id: message.id,
      channel: message.channel,
      ok: true,
      payload: {
        ...healthPayload,
        lastSyncAt: new Date().toISOString(),
        serviceStatus: {
          ...healthPayload.serviceStatus,
          lastUpdateAt: new Date().toISOString(),
        },
      },
    });
    return;
  }

  parentPort.postMessage({
    kind: 'response',
    id: message.id,
    channel: message.channel,
    ok: false,
    error: 'unsupported smoke channel',
  });
});
`;

  fs.mkdirSync(path.dirname(unpackedWorkerPath), { recursive: true });
  fs.mkdirSync(path.dirname(asarWorkerPath), { recursive: true });
  fs.writeFileSync(unpackedWorkerPath, createWorkerSource('smoke-worker-ready-unpacked'), 'utf8');
  fs.writeFileSync(asarWorkerPath, createWorkerSource('smoke-worker-ready-asar'), 'utf8');
  setResourcesPath(resourcesPath);

  const client = new CoreWorkerClient({
    dbPath: 'D:\\runtime-data\\db\\main.sqlite',
    proxyUrl: null,
    builtinSoundDir: 'C:\\sounds',
  });

  try {
    client.start();
    const health = await client.invoke('app.getHealth');
    assert.equal(client.isRunning(), true);
    assert.equal(health.workerRunning, true);
    assert.equal(health.diagnostic, 'smoke-worker-ready-unpacked');
  } finally {
    await client.stop().catch(() => undefined);
  }
};

try {
  await runScenario('isolated runtime path + sqlite bootstrap', verifyIsolatedRuntimeDbBootstrap);
  await runScenario('runtime path failure stays before app.setPath', verifyRuntimePathFailureDoesNotTouchAppState);
  await runScenario('missing packaged worker is surfaced as packaging error', verifyPackagedWorkerMissingIsSurfaced);
  await runScenario(
    'packaged worker entry prefers app.asar.unpacked and launches from resources',
    verifyPackagedWorkerLaunchesFromResources,
  );
  process.stdout.write('[startup-smoke] all scenarios passed\n');
} catch (error) {
  process.stderr.write(`[startup-smoke] failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  cleanup();
  process.exit(1);
}

cleanup();
