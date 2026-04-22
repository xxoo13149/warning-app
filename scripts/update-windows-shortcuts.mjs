import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const packageDir = path.resolve(
  projectRoot,
  '..',
  'warning-app-artifacts',
  'Polymarket Weather Monitor-win32-x64',
);
const targetExe = path.join(packageDir, 'PolymarketWeatherMonitor.exe');

if (process.platform !== 'win32') {
  console.log('[shortcuts] skipped: Windows shortcuts are only updated on Windows.');
  process.exit(0);
}

if (!existsSync(targetExe)) {
  console.warn(`[shortcuts] skipped: packaged app not found at ${targetExe}`);
  process.exit(0);
}

const powershellScript = String.raw`
$ErrorActionPreference = 'Stop'
$targetExe = $env:WARNING_APP_SHORTCUT_TARGET
$workingDir = $env:WARNING_APP_SHORTCUT_WORKDIR
$description = '天气预警台'

$desktopDir = [Environment]::GetFolderPath('DesktopDirectory')
$programsDir = [Environment]::GetFolderPath('Programs')

$shortcuts = @()
if ($desktopDir) {
  $shortcuts += [PSCustomObject]@{
    Path = Join-Path $desktopDir '天气.lnk'
    Label = '桌面快捷方式'
  }
}
if ($programsDir) {
  $shortcuts += [PSCustomObject]@{
    Path = Join-Path $programsDir 'Polymarket Weather Monitor.lnk'
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
      WARNING_APP_SHORTCUT_TARGET: targetExe,
      WARNING_APP_SHORTCUT_WORKDIR: packageDir,
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
