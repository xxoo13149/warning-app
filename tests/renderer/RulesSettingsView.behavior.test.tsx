// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '../../src/renderer/i18n';
import { RulesSettingsView } from '../../src/renderer/views/RulesSettingsView';
import type {
  AlertRule,
  AppHealth,
  AppSettings,
  MarketRow,
  PreviewSoundResult,
  RulePreviewResult,
  RuntimeActionFeedback,
  SoundProfile,
} from '../../src/renderer/types/contracts';
import type { AppControlState, StartupStatus } from '../../src/shared/contracts';

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

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

const buildRule = (overrides: Partial<AlertRule> = {}): AlertRule => ({
  id: overrides.id ?? 'rule-1',
  name: overrides.name ?? '盘口斩杀',
  isBuiltin: overrides.isBuiltin ?? true,
  builtinKey: overrides.builtinKey ?? 'liquidity_kill',
  metric: overrides.metric ?? 'liquidity_kill',
  operator: overrides.operator ?? '>=',
  threshold: overrides.threshold ?? 0.2,
  windowSec: overrides.windowSec ?? 30,
  cooldownSec: overrides.cooldownSec ?? 120,
  dedupeWindowSec: overrides.dedupeWindowSec ?? 60,
  bubbleWeight: overrides.bubbleWeight ?? 90,
  severity: overrides.severity ?? 'warning',
  enabled: overrides.enabled ?? true,
  soundProfileId: overrides.soundProfileId ?? '',
  liquiditySide: overrides.liquiditySide ?? 'both',
  scope: overrides.scope ?? {},
  quietHours: overrides.quietHours,
});

const buildMarketRow = (overrides: Partial<MarketRow> = {}): MarketRow => ({
  marketId: overrides.marketId ?? 'market-1',
  cityKey: overrides.cityKey ?? 'beijing',
  cityName: overrides.cityName ?? 'Beijing',
  airportCode: overrides.airportCode ?? 'ZBAA',
  eventDate: overrides.eventDate ?? '2026-04-29',
  temperatureBand: overrides.temperatureBand ?? '20 C to 21 C',
  side: overrides.side ?? 'YES',
  yesPrice: overrides.yesPrice ?? 0.42,
  noPrice: overrides.noPrice ?? 0.58,
  bestBid: overrides.bestBid ?? 0.41,
  bestAsk: overrides.bestAsk ?? 0.43,
  spread: overrides.spread ?? 0.02,
  change5m: overrides.change5m ?? 1.5,
  volume24h: overrides.volume24h ?? 1000,
  status: overrides.status ?? 'active',
  bubbleScore: overrides.bubbleScore ?? 0,
  bubbleSeverity: overrides.bubbleSeverity ?? 'none',
  bubbleUpdatedAt: overrides.bubbleUpdatedAt ?? '2026-04-29T01:00:00.000Z',
  updatedAt: overrides.updatedAt ?? '2026-04-29T01:00:00.000Z',
  watchlisted: overrides.watchlisted ?? false,
});

const buildPreviewResult = (): RulePreviewResult => ({
  matchedCityCount: 1,
  matchedMarketCount: 1,
  sampleMarkets: [
    {
      marketId: 'market-1',
      cityKey: 'beijing',
      cityName: 'Beijing',
      eventDate: '2026-04-29',
      temperatureBand: '20 C to 21 C',
      side: 'YES',
      yesPrice: 0.42,
      bestBid: 0.41,
      bestAsk: 0.43,
      spread: 0.02,
      updatedAt: '2026-04-29T01:00:00.000Z',
    },
  ],
});

const previewSoundResult: PreviewSoundResult = {
  ok: true,
  played: true,
};

const clickButton = async (text: string) => {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find((item) =>
    item.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  return button;
};

const renderView = async ({
  rules = [buildRule()],
  marketRows = [buildMarketRow()],
  onSaveRules = vi.fn(),
  onPreviewRule = vi.fn(async () => buildPreviewResult()),
}: {
  rules?: AlertRule[];
  marketRows?: MarketRow[];
  onSaveRules?: ReturnType<typeof vi.fn>;
  onPreviewRule?: ReturnType<typeof vi.fn>;
} = {}) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <LocaleProvider>
        <RulesSettingsView
          rules={rules}
          marketRows={marketRows}
          latestAlertAtByRuleId={{}}
          health={buildHealth()}
          settings={buildSettings()}
          storageSummary={null}
          storageMaintenance={null}
          controlState={buildControlState()}
          runtimeAction={buildRuntimeAction()}
          soundProfiles={buildSoundProfiles()}
          onPreviewRule={onPreviewRule}
          onSaveRules={onSaveRules}
          onUpdateSettings={async () => undefined}
          onPickSound={async () => undefined}
          onRegisterSound={async () => undefined}
          onClearStorageCache={async () => ({
            reclaimedBytes: 0,
            deletedEntries: [],
            storageSummary: {
              dataRootDir: '',
              mainDbPath: '',
              archiveDir: '',
              backupDir: '',
              sessionDataDir: '',
              logsDir: '',
              mainDbExists: true,
              mainDbSizeBytes: 0,
              totalSizeBytes: 0,
              databaseSizeBytes: 0,
              archiveSizeBytes: 0,
              backupSizeBytes: 0,
              sessionDataSizeBytes: 0,
              logsSizeBytes: 0,
              cleanableSizeBytes: 0,
              canClearCache: false,
              lastCleanupAt: null,
              priceTickCount: 0,
              alertEventCount: 0,
              latestPriceTickAt: null,
              latestAlertAt: null,
              lastActivityAt: null,
              latestMainBackupPath: null,
              latestMainBackupAt: null,
              latestBackupPath: null,
              latestBackupAt: null,
            },
          })}
          onCreateStorageBackup={async () => {
            throw new Error('unused');
          }}
          onCreateDiagnosticsPackage={async () => {
            throw new Error('unused');
          }}
          onRunStorageMaintenance={async () => {
            throw new Error('unused');
          }}
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

  return { onSaveRules, onPreviewRule };
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

describe('RulesSettingsView behavior', () => {
  it('keeps enable toggles in draft state until the user saves', async () => {
    const onSaveRules = vi.fn();
    await renderView({ onSaveRules });

    const toggle = container?.querySelector(
      '.rule-card__toggle-field input[type="checkbox"]',
    ) as HTMLInputElement | null;
    expect(toggle).not.toBeNull();

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });

    expect(onSaveRules).not.toHaveBeenCalled();

    await clickButton('保存草稿');
    expect(onSaveRules).toHaveBeenCalledTimes(1);
    expect(onSaveRules.mock.calls[0]?.[0]?.[0]?.enabled).toBe(false);
  });

  it('keeps editing the selected rule when filters hide it from the list', async () => {
    await renderView({
      rules: [
        buildRule({ id: 'rule-visible', name: '盘口斩杀 A', enabled: true }),
        buildRule({ id: 'rule-hidden', name: '盘口斩杀 B', enabled: false }),
      ],
    });

    const secondRule = Array.from(container?.querySelectorAll('.rule-card strong') ?? []).find((item) =>
      item.textContent?.includes('盘口斩杀 B'),
    ) as HTMLElement | undefined;
    expect(secondRule).toBeDefined();

    await act(async () => {
      secondRule?.closest('.rule-card')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    await clickButton('只看已启用');
    expect(container?.textContent).toContain('当前选中的规则被筛选器隐藏了');
    expect(container?.textContent).toContain('盘口斩杀 B');
  });

  it('shows preview sample markets for the currently selected rule', async () => {
    const onPreviewRule = vi.fn(async () => buildPreviewResult());
    await renderView({ onPreviewRule });

    await clickButton('预览影响');

    expect(onPreviewRule).toHaveBeenCalledTimes(1);
    expect(container?.textContent).toContain('Beijing');
    expect(container?.textContent).toContain('买一 41 美分');
  });
});
