import path from 'node:path';
import fs from 'node:fs';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const externalArtifactsRoot = process.env.WARNING_APP_ARTIFACTS_ROOT
  ? path.resolve(process.env.WARNING_APP_ARTIFACTS_ROOT)
  : path.resolve(process.cwd(), '..', 'warning-app-artifacts');
const externalRuntimeDepsRoot = process.env.WARNING_APP_RUNTIME_DEPS_ROOT
  ? path.resolve(process.env.WARNING_APP_RUNTIME_DEPS_ROOT)
  : path.resolve(process.cwd(), '..', 'warning-app-runtime_node_modules');
const externalRuntimeNodeModules = path.resolve(externalRuntimeDepsRoot, 'node_modules');
const packagedViteResourceDir = path.resolve(process.cwd(), '.vite');
const electronPackageJsonPath = path.resolve(process.cwd(), 'node_modules', 'electron', 'package.json');
const electronVersion = fs.existsSync(electronPackageJsonPath)
  ? JSON.parse(fs.readFileSync(electronPackageJsonPath, 'utf8')).version
  : null;

const findLocalElectronZipDir = () => {
  if (process.platform !== 'win32' || process.arch !== 'x64' || !electronVersion) {
    return undefined;
  }

  const cacheRoot = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'electron', 'Cache')
    : undefined;
  if (!cacheRoot || !fs.existsSync(cacheRoot)) {
    return undefined;
  }

  const expectedZipName = `electron-v${electronVersion}-win32-x64.zip`;
  for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidateDir = path.join(cacheRoot, entry.name);
    const candidateZip = path.join(candidateDir, expectedZipName);
    if (fs.existsSync(candidateZip)) {
      return candidateDir;
    }
  }

  return undefined;
};

const localElectronZipDir = findLocalElectronZipDir();

const config: ForgeConfig = {
  outDir: externalArtifactsRoot,
  packagerConfig: {
    asar: {
      unpack: '.vite/build/{worker.js,worker.js.map,worker-runtime-*.js,worker-runtime-*.js.map}',
    },
    executableName: 'PolymarketWeatherMonitor',
    extraResource: [externalRuntimeNodeModules, packagedViteResourceDir],
    ...(localElectronZipDir ? { electronZipDir: localElectronZipDir } : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'polymarket_weather_monitor',
      setupExe: '天气监控安装包.exe',
      noMsi: true,
    }),
    new MakerZIP({}, ['win32']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
        {
          entry: 'src/worker.ts',
          config: 'vite.worker.config.ts',
          target: 'main',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
};

export default config;
