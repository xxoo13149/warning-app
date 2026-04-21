import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const sourceNodeModules = path.join(projectRoot, 'node_modules');
const runtimeRoot = path.resolve(projectRoot, '..', 'warning-app-runtime_node_modules');
const runtimeNodeModules = path.join(runtimeRoot, 'node_modules');

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
