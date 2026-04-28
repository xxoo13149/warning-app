import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rebuild } from '@electron/rebuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const sourceNodeModules = path.join(projectRoot, 'node_modules');
const runtimeRoot = process.env.WARNING_APP_RUNTIME_DEPS_ROOT
  ? path.resolve(process.env.WARNING_APP_RUNTIME_DEPS_ROOT)
  : path.resolve(projectRoot, '..', 'warning-app-runtime_node_modules');
const runtimeNodeModules = path.join(runtimeRoot, 'node_modules');
const electronPackageJsonPath = path.join(sourceNodeModules, 'electron', 'package.json');
const electronVersion = existsSync(electronPackageJsonPath)
  ? JSON.parse(readFileSync(electronPackageJsonPath, 'utf8')).version
  : null;
const prebuildInstallBinPath = path.join(sourceNodeModules, 'prebuild-install', 'bin.js');

const requiredPackages = [
  'better-sqlite3',
  'bindings',
  'file-uri-to-path',
  'ws',
  'https-proxy-agent',
  'agent-base',
  'debug',
  'ms',
];

const optionalPackages = [
  'bufferutil',
  'utf-8-validate',
];

const resolvePackageVersion = async (packageName) => {
  const packageJsonPath = path.join(sourceNodeModules, packageName, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  return packageJson.version;
};

const writeRuntimePackageManifest = async () => {
  const betterSqliteVersion = await resolvePackageVersion('better-sqlite3');
  const manifest = {
    name: 'warning-app-runtime-deps',
    private: true,
    version: '0.0.0',
    description: 'Runtime dependency bundle for packaged Electron worker modules.',
    dependencies: {
      'better-sqlite3': betterSqliteVersion,
    },
  };
  await writeFile(path.join(runtimeRoot, 'package.json'), JSON.stringify(manifest, null, 2), 'utf8');
};

const runCommand = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed with exit code ${code ?? 'unknown'}: ${command} ${args.join(' ')}`));
    });
  });

const runtimeBetterSqliteDir = () => path.join(runtimeNodeModules, 'better-sqlite3');
const runtimeBetterSqliteBinaryPath = () =>
  path.join(runtimeBetterSqliteDir(), 'build', 'Release', 'better_sqlite3.node');

const installBetterSqlitePrebuilt = async () => {
  if (!electronVersion) {
    throw new Error('Missing Electron version; cannot install runtime better-sqlite3 prebuild.');
  }
  if (!existsSync(prebuildInstallBinPath)) {
    throw new Error(
      `Missing prebuild-install at ${prebuildInstallBinPath}; cannot download runtime better-sqlite3 prebuild.`,
    );
  }

  const moduleDir = runtimeBetterSqliteDir();
  await rm(path.join(moduleDir, 'build', 'Release'), { recursive: true, force: true });
  await mkdir(path.join(moduleDir, 'build', 'Release'), { recursive: true });

  await runCommand(
    process.execPath,
    [
      prebuildInstallBinPath,
      `--runtime=electron`,
      `--target=${electronVersion}`,
      `--arch=${process.arch}`,
      `--platform=${process.platform}`,
      '--force',
      '--verbose',
    ],
    moduleDir,
  );
};

const rebuildRuntimeNativeModules = async () => {
  if (!electronVersion) {
    throw new Error('Missing Electron version; cannot rebuild runtime native modules.');
  }

  await rebuild({
    buildPath: runtimeRoot,
    projectRootPath: runtimeRoot,
    electronVersion,
    arch: process.arch,
    onlyModules: ['better-sqlite3'],
    force: true,
    mode: 'sequential',
  });
};

const ensureBetterSqliteBinaryExists = async () => {
  const binaryPath = runtimeBetterSqliteBinaryPath();
  if (!existsSync(binaryPath)) {
    throw new Error(
      `Runtime better-sqlite3 binary missing after preparation: ${binaryPath}`,
    );
  }
};

const copyRuntimePackages = async () => {
  await rm(runtimeRoot, { recursive: true, force: true });
  await mkdir(runtimeNodeModules, { recursive: true });

  for (const packageName of requiredPackages) {
    const source = path.join(sourceNodeModules, packageName);
    const target = path.join(runtimeNodeModules, packageName);
    if (!existsSync(source)) {
      throw new Error(`Missing required runtime dependency: ${packageName}`);
    }
    await cp(source, target, { recursive: true, force: true });
  }

  for (const packageName of optionalPackages) {
    const source = path.join(sourceNodeModules, packageName);
    if (!existsSync(source)) {
      console.warn(`[runtime-deps] optional package missing, skipped: ${packageName}`);
      continue;
    }
    const target = path.join(runtimeNodeModules, packageName);
    await cp(source, target, { recursive: true, force: true });
  }

  await writeRuntimePackageManifest();

  try {
    console.log('[runtime-deps] installing Electron prebuilt for better-sqlite3...');
    await installBetterSqlitePrebuilt();
  } catch (error) {
    console.warn(
      '[runtime-deps] failed to install Electron prebuilt for better-sqlite3; falling back to @electron/rebuild.',
    );
    console.warn(error instanceof Error ? error.message : String(error));
    await rebuildRuntimeNativeModules();
  }

  await ensureBetterSqliteBinaryExists();
};

void copyRuntimePackages()
  .then(() => {
    console.log(
      `[runtime-deps] prepared ${requiredPackages.length} required packages (+ optional when available) in ${runtimeNodeModules}`,
    );
  })
  .catch((error) => {
    console.error('[runtime-deps] failed:', error);
    process.exitCode = 1;
  });
