// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '../../src/renderer/i18n';
import type {
  AppHealth,
  AppSettings,
  MarketRow,
  PreviewSoundResult,
  RulePreviewResult,
  RuntimeActionFeedback,
  SoundProfile,
} from '../../src/renderer/types/contracts';
import type { AlertRule } from '../../src/renderer/utils/rules-settings';
import { RulesSettingsView } from '../../src/renderer/views/RulesSettingsView';
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
  name: overrides.name ?? 'Price shock',
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

const clickElement = async (element: Element | null | undefined) => {
  expect(element).not.toBeNull();
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
};

const getRuleCard = (name: string) =>
  Array.from(container?.querySelectorAll('.rule-card') ?? []).find((item) =>
    item.textContent?.includes(name),
  ) ?? null;

const getRuleDialog = () => container?.querySelector('[role="dialog"]') ?? null;

type RenderViewOptions = {
  rules?: AlertRule[];
  marketRows?: MarketRow[];
  onSaveRules?: ReturnType<typeof vi.fn>;
  onPreviewRule?: ReturnType<typeof vi.fn>;
};

const buildView = ({
  rules,
  marketRows,
  onSaveRules,
  onPreviewRule,
}: Required<RenderViewOptions>) => (
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
  </LocaleProvider>
);

const renderView = async ({
  rules = [buildRule()],
  marketRows = [buildMarketRow()],
  onSaveRules = vi.fn(),
  onPreviewRule = vi.fn(async () => buildPreviewResult()),
}: RenderViewOptions = {}) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  let currentOptions: Required<RenderViewOptions> = {
    rules,
    marketRows,
    onSaveRules,
    onPreviewRule,
  };

  const renderCurrent = async () => {
    await act(async () => {
      root?.render(buildView(currentOptions));
      await Promise.resolve();
    });
  };

  await renderCurrent();

  return {
    onSaveRules,
    onPreviewRule,
    rerender: async (nextOptions: RenderViewOptions = {}) => {
      currentOptions = {
        ...currentOptions,
        ...nextOptions,
      };
      await renderCurrent();
    },
  };
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
  it('opens the rule editor dialog when clicking a rule card', async () => {
    await renderView({
      rules: [
        buildRule({ id: 'rule-1', name: 'Price shock A' }),
        buildRule({ id: 'rule-2', name: 'Price shock B' }),
      ],
    });

    expect(getRuleDialog()).toBeNull();

    await clickElement(getRuleCard('Price shock B'));

    const dialog = getRuleDialog();
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('Price shock B');
  });

  it('closes the rule editor dialog from the backdrop and close button', async () => {
    await renderView();

    await clickElement(getRuleCard('Price shock'));
    expect(getRuleDialog()).not.toBeNull();

    const backdrop = container?.querySelector('[data-testid="rule-editor-backdrop"]');
    expect(backdrop).not.toBeNull();
    await clickElement(backdrop);
    expect(getRuleDialog()).toBeNull();

    await clickElement(getRuleCard('Price shock'));
    const closeButton = container?.querySelector(
      'button[aria-label="close-rule-editor"]',
    ) as HTMLButtonElement | null;
    expect(closeButton).not.toBeNull();
    await clickElement(closeButton);
    expect(getRuleDialog()).toBeNull();
  });

  it('keeps the open rule draft stable when props refresh mid-review', async () => {
    const { onSaveRules, rerender } = await renderView();

    await clickElement(getRuleCard('Price shock'));

    const dialog = getRuleDialog();
    expect(dialog).not.toBeNull();

    const enabledToggle = dialog?.querySelector(
      '.rule-editor-section:first-of-type .rule-editor-section__grid input[type="checkbox"]',
    ) as HTMLInputElement | null;
    expect(enabledToggle).not.toBeNull();
    expect(enabledToggle?.checked).toBe(true);

    const advancedSection = dialog?.querySelector(
      '.rule-editor-advanced',
    ) as HTMLDetailsElement | null;
    expect(advancedSection).not.toBeNull();

    await act(async () => {
      if (advancedSection) {
        advancedSection.open = true;
      }
      await Promise.resolve();
    });

    await clickElement(enabledToggle);

    expect(onSaveRules).toHaveBeenCalled();
    expect(
      (getRuleDialog()?.querySelector(
        '.rule-editor-section:first-of-type .rule-editor-section__grid input[type="checkbox"]',
      ) as HTMLInputElement | null)?.checked,
    ).toBe(false);

    await rerender({
      rules: [buildRule({ id: 'rule-1', enabled: true, name: 'Price shock from refresh' })],
    });

    const refreshedDialog = getRuleDialog();
    expect(refreshedDialog).not.toBeNull();
    expect(refreshedDialog?.textContent).not.toContain('Price shock from refresh');

    const refreshedToggle = refreshedDialog?.querySelector(
      '.rule-editor-section:first-of-type .rule-editor-section__grid input[type="checkbox"]',
    ) as HTMLInputElement | null;
    expect(refreshedToggle?.checked).toBe(false);

    const refreshedAdvancedSection = refreshedDialog?.querySelector(
      '.rule-editor-advanced',
    ) as HTMLDetailsElement | null;
    expect(refreshedAdvancedSection?.open).toBe(true);
  });

  it('keeps scope controls out of the modal editor', async () => {
    await renderView({
      rules: [
        buildRule({
          id: 'rule-quiet-hours',
          name: 'Quiet hours guard',
          metric: 'change5m',
        }),
      ],
    });

    await clickElement(getRuleCard('Quiet hours guard'));

    const dialog = getRuleDialog();
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).not.toContain('监控范围');
    expect(dialog?.textContent).not.toContain('指定盘口');
    expect(dialog?.querySelector('.rule-scope-guide')).toBeNull();
  });

  it('applies the quick toggle without opening the rule editor dialog', async () => {
    const onSaveRules = vi.fn();
    await renderView({ onSaveRules });

    const toggle = container?.querySelector(
      '.rule-card__toggle-field input[type="checkbox"]',
    ) as HTMLInputElement | null;
    expect(toggle).not.toBeNull();
    expect(getRuleDialog()).toBeNull();

    await clickElement(toggle);

    expect(onSaveRules).toHaveBeenCalledTimes(1);
    expect(onSaveRules.mock.calls[0]?.[0]?.[0]?.enabled).toBe(false);
    expect(getRuleDialog()).toBeNull();
  });

  it('does not rely on the retired inline rule editor', async () => {
    await renderView({
      rules: [
        buildRule({
          id: 'rule-abnormal-lottery',
          name: 'Abnormal lottery',
          builtinKey: 'abnormal_lottery',
          metric: 'abnormal_lottery',
        }),
      ],
    });

    expect(container?.querySelector('.rule-editor-layout__form')).toBeNull();
    expect(container?.querySelector('.rule-editor-layout__summary')).toBeNull();
    expect(container?.textContent).not.toContain('Save draft');
    expect(container?.textContent).not.toContain('Preview impact');

    await clickElement(getRuleCard('Abnormal lottery'));
    expect(getRuleDialog()).not.toBeNull();
  });
});
