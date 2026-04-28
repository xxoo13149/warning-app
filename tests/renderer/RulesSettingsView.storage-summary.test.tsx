// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '../../src/renderer/i18n';
import type {
  AppHealth,
  AppSettings,
  PreviewSoundResult,
  RegisterSoundPayload,
  RuntimeDiagnosticsPackageResult,
  RuntimeActionFeedback,
  RuntimeStorageSummary,
  RulePreviewResult,
  SoundProfile,
  StorageBackupResult,
  StorageCleanupResult,
  StorageMaintenanceResult,
  StorageMaintenanceSummary,
} from '../../src/renderer/types/contracts';
import { RulesSettingsView } from '../../src/renderer/views/RulesSettingsView';
import type { AppControlState, StartupStatus } from '../../src/shared/contracts';

const buildStartupStatus = (): StartupStatus => ({
  phase: 'ready',
  attempts: 1,
  maxAttempts: 3,
  startedAt: '2026-04-24T01:00:00.000Z',
  updatedAt: '2026-04-24T01:00:00.000Z',
  healthReason: null,
  lastError: null,
});

const buildHealth = (): AppHealth => ({
  connected: true,
  mode: 'live',
  shardActive: 1,
  shardTotal: 1,
  subscribedTokens: 12,
  reconnects: 0,
  latencyMs: 120,
  droppedEvents: 0,
  lastSyncAt: '2026-04-24T01:00:00.000Z',
  workerRunning: true,
  startupPhase: 'running',
  diagnostic: null,
  errorSource: null,
  serviceStatus: {
    coreWorker: 'running',
    discovery: 'ready',
    websocket: 'connected',
    dataFreshness: 'realtime',
    activeShards: 1,
    totalShards: 1,
    lagMs: 120,
    lastUpdateAt: '2026-04-24T01:00:00.000Z',
    lastError: null,
    lastErrorSource: null,
  },
});

const buildSettings = (): AppSettings => ({
  startOnBoot: false,
  backgroundAudio: true,
  reconnectPolicy: 'balanced',
  pollIntervalSec: 60,
  tickRetentionDays: 7,
  alertRetentionDays: 90,
  selectedSoundProfileId: 'builtin-soft',
  quietHoursStart: '23:00',
  quietHoursEnd: '06:00',
});

const buildControlState = (): AppControlState => ({
  notificationsEnabled: true,
  coreProcessRunning: true,
  startupStatus: buildStartupStatus(),
});

const buildRuntimeAction = (): RuntimeActionFeedback => ({
  kind: 'idle',
  busy: false,
  progress: 0,
  message: '',
  error: null,
});

const buildSoundProfiles = (): SoundProfile[] => [
  {
    id: 'builtin-soft',
    name: 'Soft Chime',
    filePath: 'C:\\sounds\\soft-chime.wav',
    gain: 0.8,
    enabled: true,
    isBuiltin: true,
    isDefault: true,
  },
];

const buildStorageSummary = (
  overrides: Partial<RuntimeStorageSummary> = {},
): RuntimeStorageSummary => ({
  dataRootDir: 'D:\\weather-monitor-data',
  mainDbPath: 'D:\\weather-monitor-data\\db\\main.sqlite',
  archiveDir: 'D:\\weather-monitor-data\\db\\archive',
  backupDir: 'D:\\weather-monitor-data\\backup',
  sessionDataDir: 'D:\\weather-monitor-data\\session-data',
  logsDir: 'D:\\weather-monitor-data\\logs',
  mainDbExists: true,
  mainDbSizeBytes: 1024,
  totalSizeBytes: 4096,
  databaseSizeBytes: 1024,
  archiveSizeBytes: 512,
  backupSizeBytes: 768,
  sessionDataSizeBytes: 1024,
  logsSizeBytes: 256,
  cleanableSizeBytes: 768,
  cleanableEntryCount: 2,
  sessionPersistentSizeBytes: 256,
  archiveFileCount: 1,
  backupFileCount: 1,
  logFileCount: 1,
  latestLogAt: '2026-04-24T01:20:00.000Z',
  canClearCache: true,
  lastCleanupAt: null,
  priceTickCount: 12,
  alertEventCount: 3,
  latestPriceTickAt: '2026-04-23T00:00:00.000Z',
  latestAlertAt: '2026-04-23T00:05:00.000Z',
  lastActivityAt: '2026-04-23T00:05:00.000Z',
  latestMainBackupPath: 'D:\\weather-monitor-data\\backup\\main-backup-20260424-014000.sqlite',
  latestMainBackupAt: '2026-04-24T01:40:00.000Z',
  latestBackupPath: 'D:\\weather-monitor-data\\backup\\main-backup-20260424-014000.sqlite',
  latestBackupAt: '2026-04-24T01:40:00.000Z',
  ...overrides,
});

const buildStorageMaintenanceSummary = (
  overrides: Partial<StorageMaintenanceSummary> = {},
): StorageMaintenanceSummary => ({
  status: 'idle',
  lastRunAt: null,
  lastSuccessAt: null,
  lastDurationMs: null,
  lastArchivedRows: 0,
  lastPrunedTickRows: 0,
  lastPrunedAlertRows: 0,
  lastCheckpointAt: null,
  lastCompactionAt: null,
  lastReason: null,
  lastError: null,
  ...overrides,
});

const buildStorageBackupResult = (): StorageBackupResult => ({
  backupPath: 'D:\\weather-monitor-data\\backup\\main-backup-20260424-014000.sqlite',
  storageSummary: buildStorageSummary(),
});

const buildStorageCleanupResult = (
  storageSummary: RuntimeStorageSummary = buildStorageSummary({
    cleanableSizeBytes: 0,
    canClearCache: false,
    lastCleanupAt: '2026-04-24T02:00:00.000Z',
  }),
): StorageCleanupResult => ({
  reclaimedBytes: 768,
  deletedEntries: ['Code Cache', 'GPUCache'],
  storageSummary,
});

const buildStorageMaintenanceResult = (): StorageMaintenanceResult => ({
  summary: buildStorageMaintenanceSummary({
    status: 'success',
    lastRunAt: '2026-04-24T02:10:00.000Z',
    lastSuccessAt: '2026-04-24T02:10:00.000Z',
    lastDurationMs: 450,
    lastArchivedRows: 120,
    lastPrunedTickRows: 120,
    lastPrunedAlertRows: 4,
    lastCheckpointAt: '2026-04-24T02:10:00.000Z',
    lastReason: 'manual',
  }),
  storageSummary: buildStorageSummary(),
});

const buildRuntimeDiagnosticsPackageResult = (): RuntimeDiagnosticsPackageResult => ({
  packagePath: 'D:\\weather-monitor-data\\diagnostics\\runtime-diagnostics-20260424-020000.json',
  diagnostics: {
    version: 1,
    generatedAt: '2026-04-24T02:00:00.000Z',
    runtimePaths: {
      dataRootDir: 'D:\\weather-monitor-data',
      dbDir: 'D:\\weather-monitor-data\\db',
      mainDbPath: 'D:\\weather-monitor-data\\db\\main.sqlite',
      archiveDir: 'D:\\weather-monitor-data\\db\\archive',
      backupDir: 'D:\\weather-monitor-data\\backup',
      sessionDataDir: 'D:\\weather-monitor-data\\session-data',
      logsDir: 'D:\\weather-monitor-data\\logs',
    },
    storageSummary: buildStorageSummary(),
    process: {
      pid: 1234,
      platform: 'win32',
      arch: 'x64',
      nodeVersion: '24.0.0',
      electronVersion: '41.2.0',
    },
    logs: {
      directory: 'D:\\weather-monitor-data\\logs',
      fileCount: 1,
      includedFileCount: 1,
      tailBytes: 1024,
      files: [],
    },
    privacy: {
      format: 'json',
      excludes: ['main.sqlite contents'],
    },
  },
});

const buildRulePreviewResult = (): RulePreviewResult => ({
  matchedCityCount: 0,
  matchedMarketCount: 0,
  sampleMarkets: [],
});

interface RenderOptions {
  storageSummary: RuntimeStorageSummary | null;
  storageMaintenance?: StorageMaintenanceSummary | null;
  onCreateStorageBackup?: () => Promise<StorageBackupResult>;
  onCreateDiagnosticsPackage?: () => Promise<RuntimeDiagnosticsPackageResult>;
  onClearStorageCache?: () => Promise<StorageCleanupResult>;
  onRunStorageMaintenance?: () => Promise<StorageMaintenanceResult>;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

const renderView = async ({
  storageSummary,
  storageMaintenance = buildStorageMaintenanceSummary(),
  onCreateStorageBackup = async () => buildStorageBackupResult(),
  onCreateDiagnosticsPackage = async () => buildRuntimeDiagnosticsPackageResult(),
  onClearStorageCache = async () => buildStorageCleanupResult(),
  onRunStorageMaintenance = async () => buildStorageMaintenanceResult(),
}: RenderOptions) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  const previewSoundResult: PreviewSoundResult = {
    ok: true,
    played: true,
  };

  await act(async () => {
    root?.render(
      <LocaleProvider>
        <RulesSettingsView
          rules={[]}
          marketRows={[]}
          latestAlertAtByRuleId={{}}
          health={buildHealth()}
          settings={buildSettings()}
          storageSummary={storageSummary}
          storageMaintenance={storageMaintenance}
          controlState={buildControlState()}
          runtimeAction={buildRuntimeAction()}
          soundProfiles={buildSoundProfiles()}
          onPreviewRule={async () => buildRulePreviewResult()}
          onSaveRules={() => undefined}
          onUpdateSettings={async () => undefined}
          onPickSound={async () => undefined}
          onRegisterSound={async (_payload?: RegisterSoundPayload) => undefined}
          onClearStorageCache={onClearStorageCache}
          onCreateStorageBackup={onCreateStorageBackup}
          onCreateDiagnosticsPackage={onCreateDiagnosticsPackage}
          onRunStorageMaintenance={onRunStorageMaintenance}
          onPreviewSound={async () => previewSoundResult}
          onImportCityMap={async () => 0}
          onSetNotificationsEnabled={() => undefined}
          onStopMonitor={() => undefined}
          onStartMonitor={() => undefined}
          onQuitApp={() => undefined}
        />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
};

beforeEach(() => {
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await Promise.resolve();
    });
  }

  root = null;
  container?.remove();
  container = null;
  testGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('RulesSettingsView storage summary', () => {
  it('shows productized storage summary cards and hides raw table names from the default view', async () => {
    await renderView({ storageSummary: buildStorageSummary() });

    const storagePanel = container?.querySelector('[aria-label="storage-summary"]');
    const storageCards = storagePanel?.querySelectorAll('.settings-readiness-card');
    expect(storagePanel).not.toBeNull();
    expect(storagePanel?.textContent).toContain('可释放空间');
    expect(storageCards).toHaveLength(4);
    expect(storagePanel?.textContent).toContain('会保留的数据');
    expect(storagePanel?.textContent).toContain('备份保护');
    expect(storagePanel?.textContent).toContain('自动节省空间');
    expect(storagePanel?.textContent).not.toContain('D:\\weather-monitor-data');
    expect(storagePanel?.textContent).toContain('保存的数据已就绪');
    expect(storagePanel?.textContent).toContain('保存 7/90 天');
    expect(storagePanel?.textContent).not.toContain('旧热数据');
    expect(storagePanel?.textContent).not.toContain('行情');
    expect(storagePanel?.textContent).not.toContain('主库');
    expect(storagePanel?.textContent).not.toContain('主数据库');
    expect(storagePanel?.textContent).not.toContain('归档');
    expect(storagePanel?.textContent).not.toContain('Tick');
    expect(storagePanel?.textContent).not.toContain('price_ticks');
    expect(storagePanel?.textContent).not.toContain('alert_events');
  });

  it('disables saving a data copy when the data file is missing and shows explicit feedback', async () => {
    const onCreateStorageBackup = vi.fn(async () => buildStorageBackupResult());

    await renderView({
      storageSummary: buildStorageSummary({
        mainDbExists: false,
        mainDbSizeBytes: 0,
      }),
      onCreateStorageBackup,
    });

    const backupButton = container?.querySelector(
      'button[title*="main.sqlite"]',
    ) as HTMLButtonElement | null;
    const statusMessages = Array.from(container?.querySelectorAll('[role="status"]') ?? []).map(
      (item) => item.textContent ?? '',
    );

    expect(backupButton).not.toBeNull();
    expect(backupButton?.disabled).toBe(true);
    expect(statusMessages.some((message) => message.includes('main.sqlite'))).toBe(true);
    expect(onCreateStorageBackup).not.toHaveBeenCalled();
  });

  it('frees temporary storage and shows success feedback', async () => {
    const onClearStorageCache = vi.fn(async () => buildStorageCleanupResult());

    await renderView({
      storageSummary: buildStorageSummary(),
      onClearStorageCache,
    });

    const clearButton = container?.querySelector(
      'button[aria-label="storage-clear-cache"]',
    ) as HTMLButtonElement | null;

    expect(clearButton).not.toBeNull();

    await act(async () => {
      clearButton?.click();
      await Promise.resolve();
    });

    const statusMessages = Array.from(container?.querySelectorAll('[role="status"]') ?? []).map(
      (item) => item.textContent ?? '',
    );

    expect(onClearStorageCache).toHaveBeenCalledTimes(1);
    expect(statusMessages.some((message) => message.includes('释放空间完成'))).toBe(true);
  });

  it('runs space saving from the storage actions area', async () => {
    const onRunStorageMaintenance = vi.fn(async () => buildStorageMaintenanceResult());

    await renderView({
      storageSummary: buildStorageSummary(),
      onRunStorageMaintenance,
    });

    const maintenanceButton = container?.querySelector(
      'button[aria-label="storage-run-maintenance"]',
    ) as HTMLButtonElement | null;

    expect(maintenanceButton).not.toBeNull();

    await act(async () => {
      maintenanceButton?.click();
      await Promise.resolve();
    });

    const statusMessages = Array.from(container?.querySelectorAll('[role="status"]') ?? []).map(
      (item) => item.textContent ?? '',
    );

    expect(onRunStorageMaintenance).toHaveBeenCalledTimes(1);
    expect(statusMessages.some((message) => message.includes('节省空间完成'))).toBe(true);
  });

  it('creates a troubleshooting file from the storage actions area', async () => {
    const onCreateDiagnosticsPackage = vi.fn(async () => buildRuntimeDiagnosticsPackageResult());

    await renderView({
      storageSummary: buildStorageSummary(),
      onCreateDiagnosticsPackage,
    });

    const diagnosticsButton = container?.querySelector(
      'button[aria-label="storage-create-diagnostics"]',
    ) as HTMLButtonElement | null;

    expect(diagnosticsButton).not.toBeNull();

    await act(async () => {
      diagnosticsButton?.click();
      await Promise.resolve();
    });

    const statusMessages = Array.from(container?.querySelectorAll('[role="status"]') ?? []).map(
      (item) => item.textContent ?? '',
    );

    expect(onCreateDiagnosticsPackage).toHaveBeenCalledTimes(1);
    expect(
      statusMessages.some((message) => message.includes('runtime-diagnostics-20260424-020000.json')),
    ).toBe(true);
  });
});
