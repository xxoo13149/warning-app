import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';
const npxCommand = isWindows ? 'npx.cmd' : 'npx';
const defaultTimeoutMs = 120_000;

const requiredInvokeChannels = [
  'app.getHealth',
  'app.getControlState',
  'app.control',
  'dashboard.query',
  'markets.query',
  'alerts.list',
  'alerts.ack',
  'rules.list',
  'rules.preview',
  'rules.save',
  'storage.clearCache',
  'storage.createBackup',
  'storage.createDiagnostics',
  'storage.runMaintenance',
  'settings.get',
  'settings.update',
  'settings.importCityMap',
  'settings.pickSound',
  'settings.registerSound',
  'settings.previewSound',
];

const requiredEventChannels = [
  'app.health',
  'app.controlState',
  'dashboard.tick',
  'markets.tick',
  'alerts.new',
];

const readinessCommands = [
  {
    label: 'typecheck',
    command: npmCommand,
    args: ['run', 'typecheck'],
  },
  {
    label: 'startup smoke',
    command: process.execPath,
    args: ['scripts/verify-startup-smoke.mjs'],
  },
  {
    label: 'single-instance + D-drive storage contract tests',
    command: npxCommand,
    args: [
      'vitest',
      'run',
      'tests/contracts/settings-and-app-control-ipc.test.ts',
      'tests/main/runtime-paths.test.ts',
    ],
  },
];

const releaseCommandChecklist = [
  [npmCommand, 'run', 'typecheck'],
  [process.execPath, 'scripts/verify-product-readiness.mjs'],
  [npmCommand, 'run', 'test:startup-smoke'],
  [
    npxCommand,
    'vitest',
    'run',
    'tests/main/ipc-contract-alignment.test.ts',
    'tests/contracts/settings-and-app-control-ipc.test.ts',
    'tests/main/runtime-paths.test.ts',
  ],
  [npmCommand, 'test'],
];

const readProjectFile = (relativePath) =>
  fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

const assertCondition = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const includesStringLiteral = (source, value) =>
  new RegExp(`['"\`]${escapeRegExp(value)}['"\`]`).test(source);

const hasIpcMainHandle = (source, channel) =>
  new RegExp(`ipcMain\\.handle\\(\\s*['"\`]${escapeRegExp(channel)}['"\`]`).test(source);

const hasCoreSubscription = (source, channel) =>
  new RegExp(`coreClient\\.on\\(\\s*['"\`]${escapeRegExp(channel)}['"\`]`).test(source);

const hasEmitEvent = (source, channel) =>
  new RegExp(`emitEvent\\(\\s*['"\`]${escapeRegExp(channel)}['"\`]`).test(source);

const formatCommand = (command, args = []) =>
  [command, ...args]
    .map((part) => (/\s/.test(part) ? `"${part}"` : part))
    .join(' ');

const stopChildProcess = (child) => {
  if (!child.pid || child.exitCode !== null) {
    return;
  }

  if (isWindows) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  child.kill('SIGTERM');
};

const runCommand = ({ label, command, args, timeoutMs = defaultTimeoutMs }) =>
  new Promise((resolve, reject) => {
    process.stdout.write(`\n[product-readiness] ${label}\n`);
    process.stdout.write(`[product-readiness] $ ${formatCommand(command, args)}\n`);

    const useShell = isWindows && /\.(?:cmd|bat)$/i.test(command);
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        PRODUCT_READINESS_GATE: '1',
      },
      shell: useShell,
      stdio: 'inherit',
      windowsHide: true,
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopChildProcess(child);
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code ?? `signal ${signal}`}`));
    });
  });

const verifyPackageScripts = () => {
  const packageJson = JSON.parse(readProjectFile('package.json'));
  const scripts = packageJson.scripts ?? {};
  for (const scriptName of ['typecheck', 'test', 'test:startup-smoke', 'test:product-readiness']) {
    assertCondition(
      typeof scripts[scriptName] === 'string' && scripts[scriptName].trim().length > 0,
      `package.json missing required script: ${scriptName}`,
    );
  }
};

const verifySingleInstanceContract = () => {
  const source = readProjectFile('src/main/index.ts');
  const sharedConstantsSource = readProjectFile('src/shared/constants.ts');
  assertCondition(
    sharedConstantsSource.includes("APP_USER_MODEL_ID = 'com.polymarket.weather-monitor'") ||
      sharedConstantsSource.includes('APP_USER_MODEL_ID = "com.polymarket.weather-monitor"'),
    'shared constants must expose the stable Windows AppUserModelID',
  );
  assertCondition(
    source.includes('app.setAppUserModelId(APP_USER_MODEL_ID);'),
    'main entry must set the stable Windows AppUserModelID before startup continues',
  );
  assertCondition(
    source.includes('configureRuntimePaths(app)'),
    'main entry must configure runtime paths before startup continues',
  );
  assertCondition(
    source.indexOf('app.setAppUserModelId(APP_USER_MODEL_ID);') <
      source.indexOf('configureRuntimePaths(app)'),
    'AppUserModelID must be set before configuring runtime paths and notifications',
  );
  assertCondition(
    source.includes('app.requestSingleInstanceLock()'),
    'main entry must request the Electron single-instance lock',
  );
  assertCondition(
    source.indexOf('configureRuntimePaths(app)') < source.indexOf('app.requestSingleInstanceLock()'),
    'runtime paths must be configured before taking the single-instance lock',
  );
  assertCondition(
    source.includes('await prepareRuntimeStorage(app, initialRuntimePaths.dataRootDir);'),
    'main entry must prepare runtime storage before bootstrapping the app shell',
  );
  assertCondition(
    source.includes('await bootstrapAppShell(runtimePaths);'),
    'main entry must bootstrap the app shell with prepared runtime paths',
  );
  assertCondition(
    /else if \(!app\.requestSingleInstanceLock\(\)\) \{[\s\S]*?app\.quit\(\);[\s\S]*?\}/m.test(source),
    'duplicate instance branch must quit before bootstrapping the app shell',
  );
};

const verifyStoragePathContract = () => {
  const source = readProjectFile('src/main/services/runtime-paths.ts');
  assertCondition(
    /FIXED_RUNTIME_DATA_ROOT\s*=\s*['"`]D:\\/.test(source),
    'runtime storage root must remain pinned to the D drive',
  );
  assertCondition(
    source.includes('path.win32.normalize(dataRootDir)'),
    'runtime storage paths must normalize with Windows path semantics',
  );
  assertCondition(
    source.includes("electronApp.setPath('userData', runtimePaths.dataRootDir)") ||
      source.includes('electronApp.setPath("userData", runtimePaths.dataRootDir)'),
    'Electron userData must point at the configured runtime data root',
  );
  assertCondition(
    source.includes("electronApp.setPath('sessionData', runtimePaths.sessionDataDir)") ||
      source.includes('electronApp.setPath("sessionData", runtimePaths.sessionDataDir)'),
    'Electron sessionData must point at the configured runtime session directory',
  );
  assertCondition(
    source.includes('electronApp.setAppLogsPath(runtimePaths.logsDir)'),
    'Electron logs must point at the configured runtime logs directory',
  );
};

const verifyIpcContract = () => {
  const mainContractSource = readProjectFile('src/main/contracts/ipc.ts');
  const sharedConstantsSource = readProjectFile('src/shared/constants.ts');
  const registerHandlersSource = readProjectFile('src/main/ipc/register-handlers.ts');
  const appShellSource = readProjectFile('src/main/app-shell.ts');
  const preloadBridgeSource = readProjectFile('src/main/preload-bridge.ts');

  for (const channel of requiredInvokeChannels) {
    assertCondition(
      includesStringLiteral(mainContractSource, channel),
      `main IPC contract missing invoke channel: ${channel}`,
    );
    assertCondition(
      includesStringLiteral(sharedConstantsSource, channel),
      `shared IPC constants missing invoke channel: ${channel}`,
    );
    assertCondition(
      hasIpcMainHandle(registerHandlersSource, channel),
      `main IPC handlers missing ipcMain.handle for: ${channel}`,
    );
  }

  for (const channel of requiredEventChannels) {
    assertCondition(
      includesStringLiteral(mainContractSource, channel),
      `main IPC contract missing event channel: ${channel}`,
    );
    assertCondition(
      includesStringLiteral(sharedConstantsSource, channel),
      `shared IPC constants missing event channel: ${channel}`,
    );
  }

  assertCondition(
    hasEmitEvent(appShellSource, 'app.controlState'),
    'app.controlState must be emitted by the app shell control-state synchronizer',
  );
  assertCondition(
    hasCoreSubscription(registerHandlersSource, 'app.health'),
    'app.health must be subscribed from the core worker client',
  );
  assertCondition(
    registerHandlersSource.includes('setRuntimeHealth(payload);'),
    'app.health must be committed through setRuntimeHealth instead of bypassing app-shell state',
  );
  assertCondition(
    appShellSource.includes('setRuntimeHealth: setHealth,'),
    'registerIpcHandlers must receive app-shell setHealth as setRuntimeHealth',
  );
  assertCondition(
    hasEmitEvent(appShellSource, 'app.health'),
    'app.health must be emitted by the app shell health synchronizer',
  );

  for (const channel of ['dashboard.tick', 'markets.tick', 'alerts.new']) {
    assertCondition(
      hasCoreSubscription(registerHandlersSource, channel),
      `main IPC handlers missing coreClient subscription for: ${channel}`,
    );
    assertCondition(
      hasEmitEvent(registerHandlersSource, channel),
      `main IPC handlers missing renderer forwarding for: ${channel}`,
    );
  }

  for (const preloadAlias of ['warningApi', 'electronAPI', 'api']) {
    assertCondition(
      preloadBridgeSource.includes(`exposeInMainWorld('${preloadAlias}', api)`) ||
        preloadBridgeSource.includes(`exposeInMainWorld("${preloadAlias}", api)`),
      `preload bridge missing renderer API alias: ${preloadAlias}`,
    );
  }
};

const verifyStaticReadinessContracts = () => {
  process.stdout.write('[product-readiness] static contract checks\n');
  verifyPackageScripts();
  verifySingleInstanceContract();
  verifyStoragePathContract();
  verifyIpcContract();
  process.stdout.write('[product-readiness] static contract checks passed\n');
};

try {
  verifyStaticReadinessContracts();

  for (const command of readinessCommands) {
    await runCommand(command);
  }

  process.stdout.write('\n[product-readiness] release verification command checklist\n');
  for (const [command, ...args] of releaseCommandChecklist) {
    process.stdout.write(`- ${formatCommand(command, args)}\n`);
  }

  process.stdout.write('\n[product-readiness] all readiness checks passed\n');
} catch (error) {
  process.stderr.write(
    `\n[product-readiness] failed: ${
      error instanceof Error ? error.stack ?? error.message : String(error)
    }\n`,
  );
  process.exitCode = 1;
}
