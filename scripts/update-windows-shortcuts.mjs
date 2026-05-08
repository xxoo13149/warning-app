import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const artifactsRoot = path.resolve(
  process.env.WARNING_APP_ARTIFACTS_ROOT ?? path.join(projectRoot, '..', 'warning-app-artifacts'),
);
const executableName = 'PolymarketWeatherMonitor.exe';
const defaultPackageDir = path.join(artifactsRoot, '天气监控-win32-x64');
const shortcutName = '\u5929\u6c14\u76d1\u63a7.lnk';
const shortcutDescription = '\u5929\u6c14\u76d1\u63a7';

const safeStatMtime = (filePath) => {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
};

const collectExecutableCandidates = (rootDir, maxDepth = 4) => {
  if (!existsSync(rootDir)) {
    return [];
  }

  const candidates = [];
  const pendingDirs = [{ dir: rootDir, depth: 0 }];

  while (pendingDirs.length > 0) {
    const current = pendingDirs.pop();
    let entries;

    try {
      entries = readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current.dir, entry.name);

      if (entry.isFile() && entry.name === executableName) {
        candidates.push(entryPath);
        continue;
      }

      if (entry.isDirectory() && current.depth < maxDepth) {
        pendingDirs.push({ dir: entryPath, depth: current.depth + 1 });
      }
    }
  }

  return candidates;
};

const resolvePackagedTarget = () => {
  if (process.env.WARNING_APP_SHORTCUT_TARGET) {
    const targetExe = path.resolve(process.env.WARNING_APP_SHORTCUT_TARGET);
    if (!existsSync(targetExe)) {
      throw new Error(`[shortcuts] override target not found: ${targetExe}`);
    }

    return { targetExe, packageDir: path.dirname(targetExe), source: 'WARNING_APP_SHORTCUT_TARGET' };
  }

  if (process.env.WARNING_APP_PACKAGE_DIR) {
    const packageDir = path.resolve(process.env.WARNING_APP_PACKAGE_DIR);
    const targetExe = path.join(packageDir, executableName);
    if (!existsSync(targetExe)) {
      throw new Error(`[shortcuts] override package dir does not contain ${executableName}: ${packageDir}`);
    }

    return { targetExe, packageDir, source: 'WARNING_APP_PACKAGE_DIR' };
  }

  const defaultTargetExe = path.join(defaultPackageDir, executableName);
  if (existsSync(defaultTargetExe)) {
    return {
      targetExe: defaultTargetExe,
      packageDir: defaultPackageDir,
      source: 'defaultPackageDir',
    };
  }

  const candidates = collectExecutableCandidates(artifactsRoot);
  const latestTargetExe = candidates
    .map((targetExe) => ({ targetExe, updatedAt: safeStatMtime(targetExe) }))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]?.targetExe;

  if (!latestTargetExe) {
    return null;
  }

  return { targetExe: latestTargetExe, packageDir: path.dirname(latestTargetExe), source: artifactsRoot };
};

if (process.platform !== 'win32') {
  console.log('[shortcuts] skipped: Windows shortcuts are only updated on Windows.');
  process.exit(0);
}

const packagedTarget = resolvePackagedTarget();

if (!packagedTarget) {
  console.warn(`[shortcuts] skipped: packaged app not found under ${artifactsRoot}`);
  process.exit(0);
}

console.log(`[shortcuts] using packaged app from ${packagedTarget.source}: ${packagedTarget.targetExe}`);

const powershellScript = String.raw`
$ErrorActionPreference = 'Stop'
$targetExe = $env:WARNING_APP_SHORTCUT_TARGET
$workingDir = $env:WARNING_APP_SHORTCUT_WORKDIR
$shortcutName = $env:WARNING_APP_SHORTCUT_NAME
$description = $env:WARNING_APP_SHORTCUT_DESCRIPTION

$desktopDir = [Environment]::GetFolderPath('DesktopDirectory')
$programsDir = [Environment]::GetFolderPath('Programs')

$shortcuts = @()
if ($desktopDir) {
  $shortcuts += [PSCustomObject]@{
    Path = Join-Path $desktopDir $shortcutName
    Label = '桌面快捷方式'
  }
}
if ($programsDir) {
  $shortcuts += [PSCustomObject]@{
    Path = Join-Path $programsDir $shortcutName
    Label = '开始菜单快捷方式'
  }
}

$shell = New-Object -ComObject WScript.Shell
foreach ($item in $shortcuts) {
  $parent = Split-Path -Parent $item.Path
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  $shortcut = $shell.CreateShortcut($item.Path)
  $shortcut.TargetPath = $targetExe
  $shortcut.WorkingDirectory = $workingDir
  $shortcut.Arguments = ''
  $shortcut.Description = $description
  $shortcut.IconLocation = "$targetExe,0"
  $shortcut.Save()

  Write-Host "[shortcuts] updated $($item.Label): $($item.Path) -> $targetExe"
}
`;

const result = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', powershellScript],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      WARNING_APP_SHORTCUT_TARGET: packagedTarget.targetExe,
      WARNING_APP_SHORTCUT_WORKDIR: packagedTarget.packageDir,
      WARNING_APP_SHORTCUT_NAME: shortcutName,
      WARNING_APP_SHORTCUT_DESCRIPTION: shortcutDescription,
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
