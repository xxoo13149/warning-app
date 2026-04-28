// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMonitorConsole } from '../../src/renderer/hooks/useMonitorConsole';
import { LocaleProvider } from '../../src/renderer/i18n';
import type {
  AppControlState,
  AlertEvent,
  AlertListResult,
  AppHealth,
  MarketQueryResult,
  MarketRow,
  StorageBackupResult,
  StorageCleanupResult,
  StorageMaintenanceResult,
  StorageMaintenanceSummary,
  RuntimeStorageSummary,
  SettingsPayload,
  StartupStatus,
} from '../../src/renderer/types/contracts';

type Listener = (payload: unknown) => void;

const listeners = new Map<string, Set<Listener>>();
const responseQueues = new Map<string, unknown[]>();
const invokeMock = vi.fn();
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

vi.mock('../../src/renderer/api/ipcBridge', () => ({
  bridgeMode: 'mock',
  ipcBridge: {
    invoke: (channel: string, payload?: unknown) => invokeMock(channel, payload),
    on: (channel: string, listener: Listener) => {
      const channelListeners = listeners.get(channel) ?? new Set<Listener>();
      channelListeners.add(listener);
      listeners.set(channel, channelListeners);
      return () => {
        channelListeners.delete(listener);
        if (channelListeners.size === 0) {
          listeners.delete(channel);
        }
      };
    },
    off: (channel: string, listener: Listener) => {
      const channelListeners = listeners.get(channel);
      if (!channelListeners) {
        return;
      }
      channelListeners.delete(listener);
      if (channelListeners.size === 0) {
        listeners.delete(channel);
      }
    },
  },
}));

const buildStartupStatus = (phase: StartupStatus['phase']): StartupStatus => ({
  phase,
  attempts: phase === 'ready' ? 1 : 0,
  maxAttempts: 2,
  startedAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
  healthReason: null,
  lastError: null,
});

const buildHealth = (overrides: Partial<AppHealth> = {}): AppHealth => ({
  connected: false,
  mode: 'degraded',
  shardActive: 0,
  shardTotal: 0,
  subscribedTokens: 0,
  reconnects: 0,
  latencyMs: 0,
  droppedEvents: 0,
  lastSyncAt: '2026-04-23T00:00:00.000Z',
  workerRunning: false,
  startupPhase: 'starting',
  diagnostic: null,
  errorSource: 'startup',
  serviceStatus: {
    coreWorker: 'stopped',
    discovery: 'idle',
    websocket: 'disconnected',
    dataFreshness: 'unknown',
    activeShards: 0,
    totalShards: 0,
    lagMs: 0,
    lastUpdateAt: '2026-04-23T00:00:00.000Z',
    lastError: null,
    lastErrorSource: 'startup',
  },
  ...overrides,
});

const buildControlState = (overrides: Partial<AppControlState> = {}): AppControlState => ({
  notificationsEnabled: true,
  coreProcessRunning: false,
  startupStatus: buildStartupStatus('starting'),
  ...overrides,
});

const buildMarket = (overrides: Partial<MarketRow> = {}): MarketRow => ({
  marketId: 'market-1',
  cityKey: 'los-angeles',
  cityName: 'Los Angeles',
  airportCode: 'KLAX',
  eventDate: '2026-04-23',
  temperatureBand: '70F to 71F',
  side: 'BOTH',
  yesPrice: 0.42,
  noPrice: 0.58,
  bestBid: 0.41,
  bestAsk: 0.43,
  spread: 0.02,
  change5m: 1.1,
  volume24h: 1200,
  status: 'active',
  bubbleScore: 30,
  bubbleSeverity: 'warning',
  bubbleUpdatedAt: '2026-04-23T00:00:00.000Z',
  updatedAt: '2026-04-23T00:00:00.000Z',
  watchlisted: false,
  ...overrides,
});

const buildSettingsPayload = (): SettingsPayload => ({
  settings: {
    startOnBoot: false,
    backgroundAudio: true,
    reconnectPolicy: 'balanced',
    pollIntervalSec: 60,
    tickRetentionDays: 7,
    alertRetentionDays: 90,
    selectedSoundProfileId: '',
    quietHoursStart: '23:00',
    quietHoursEnd: '06:00',
  },
  soundProfiles: [],
  storageSummary: buildStorageSummary(),
  storageMaintenance: buildStorageMaintenanceSummary(),
});

const buildStorageSummary = (
  overrides: Partial<RuntimeStorageSummary> = {},
): RuntimeStorageSummary => ({
  dataRootDir: 'D:\\天气监控-data',
  mainDbPath: 'D:\\天气监控-data\\db\\main.sqlite',
  archiveDir: 'D:\\天气监控-data\\db\\archive',
  backupDir: 'D:\\天气监控-data\\backup',
  sessionDataDir: 'D:\\天气监控-data\\session-data',
  logsDir: 'D:\\天气监控-data\\logs',
  mainDbExists: true,
  mainDbSizeBytes: 1024,
  totalSizeBytes: 4096,
  databaseSizeBytes: 1024,
  archiveSizeBytes: 512,
  backupSizeBytes: 768,
  sessionDataSizeBytes: 1024,
  logsSizeBytes: 256,
  cleanableSizeBytes: 768,
  canClearCache: true,
  lastCleanupAt: null,
  priceTickCount: 12,
  alertEventCount: 3,
  latestPriceTickAt: '2026-04-23T00:00:00.000Z',
  latestAlertAt: '2026-04-23T00:05:00.000Z',
  lastActivityAt: '2026-04-23T00:05:00.000Z',
  latestMainBackupPath: 'D:\\天气监控-data\\backup\\main-backup-20260424-014000.sqlite',
  latestMainBackupAt: '2026-04-24T01:40:00.000Z',
  latestBackupPath: 'D:\\天气监控-data\\backup\\main-backup-20260424-014000.sqlite',
  latestBackupAt: '2026-04-24T01:40:00.000Z',
  ...overrides,
});

const buildStorageBackupResult = (
  overrides: Partial<StorageBackupResult> = {},
): StorageBackupResult => ({
  backupPath: 'D:\\天气监控-data\\backup\\main-backup-20260424-014000.sqlite',
  storageSummary: buildStorageSummary(),
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

const buildStorageMaintenanceResult = (
  overrides: Partial<StorageMaintenanceResult> = {},
): StorageMaintenanceResult => ({
  summary: buildStorageMaintenanceSummary({
    status: 'success',
    lastRunAt: '2026-04-24T02:10:00.000Z',
    lastSuccessAt: '2026-04-24T02:10:00.000Z',
    lastDurationMs: 420,
    lastArchivedRows: 200,
    lastPrunedTickRows: 200,
    lastPrunedAlertRows: 6,
    lastCheckpointAt: '2026-04-24T02:10:00.000Z',
    lastReason: 'manual',
  }),
  storageSummary: buildStorageSummary(),
  ...overrides,
});

const buildStorageCleanupResult = (
  overrides: Partial<StorageCleanupResult> = {},
): StorageCleanupResult => ({
  reclaimedBytes: 768,
  deletedEntries: ['Code Cache', 'GPUCache'],
  storageSummary: buildStorageSummary({
    cleanableSizeBytes: 0,
    canClearCache: false,
    lastCleanupAt: '2026-04-24T02:00:00.000Z',
  }),
  ...overrides,
});

const buildAlert = (overrides: Partial<AlertEvent> = {}): AlertEvent => ({
  id: 'alert-1',
  ruleId: 'rule-1',
  triggeredAt: '2026-04-23T00:00:00.000Z',
  cityKey: 'los-angeles',
  marketId: 'market-1',
  tokenId: 'token-1',
  message: 'Spread widened quickly',
  severity: 'warning',
  acknowledged: false,
  ...overrides,
});

const queueResponses = (channel: string, ...responses: unknown[]) => {
  responseQueues.set(channel, [...responses]);
};

const dequeueResponse = (channel: string) => {
  const queued = responseQueues.get(channel);
  if (!queued || queued.length === 0) {
    return undefined;
  }
  const next = queued.shift();
  if (queued.length === 0) {
    responseQueues.delete(channel);
  }
  return next;
};

const emit = (channel: string, payload: unknown) => {
  const channelListeners = listeners.get(channel);
  if (!channelListeners) {
    return;
  }
  for (const listener of channelListeners) {
    listener(payload);
  }
};

const countInvocations = (channel: string) =>
  invokeMock.mock.calls.filter(([currentChannel]) => currentChannel === channel).length;

const buildDefaultInvokeResponse = async (channel: string) => {
  const queued = dequeueResponse(channel);
  if (queued instanceof Error) {
    throw queued;
  }
  if (queued !== undefined) {
    return queued;
  }

  switch (channel) {
    case 'app.getHealth':
      return buildHealth();
    case 'app.getControlState':
      return buildControlState();
    case 'markets.query':
      return { rows: [], total: 0 } satisfies MarketQueryResult;
    case 'alerts.list':
      return { rows: [], total: 0, hasMore: false } satisfies AlertListResult;
    case 'settings.get':
      return buildSettingsPayload();
    case 'rules.list':
      return { rows: [] };
    default:
      throw new Error(`Unexpected invoke channel: ${channel}`);
  }
};

const flushAsyncWork = async (rounds = 4) => {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let latestState: ReturnType<typeof useMonitorConsole> | null = null;

const Harness = () => {
  latestState = useMonitorConsole();
  return null;
};

const renderHarness = async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <LocaleProvider>
        <Harness />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });

  await flushAsyncWork();
};

beforeEach(() => {
  vi.useFakeTimers();
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  listeners.clear();
  responseQueues.clear();
  latestState = null;
  invokeMock.mockReset();
  invokeMock.mockImplementation(buildDefaultInvokeResponse);
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
  latestState = null;
  listeners.clear();
  responseQueues.clear();
  testGlobal.IS_REACT_ACT_ENVIRONMENT = false;
  vi.useRealTimers();
});

describe('useMonitorConsole market hydration', () => {
  it('auto-refreshes markets once the feed becomes ready after an empty initial load', async () => {
    const hydratedMarket = buildMarket();

    queueResponses('app.getHealth', buildHealth({ startupPhase: 'starting' }));
    queueResponses(
      'app.getControlState',
      buildControlState({ startupStatus: buildStartupStatus('starting') }),
    );
    queueResponses(
      'markets.query',
      { rows: [], total: 0 } satisfies MarketQueryResult,
      { rows: [], total: 0 } satisfies MarketQueryResult,
      { rows: [hydratedMarket], total: 1 } satisfies MarketQueryResult,
    );

    await renderHarness();

    expect(countInvocations('markets.query')).toBe(2);
    expect(latestState?.markets).toEqual([]);

    await act(async () => {
      emit(
        'app.health',
        buildHealth({
          connected: true,
          mode: 'live',
          workerRunning: true,
          startupPhase: 'running',
        }),
      );
      await Promise.resolve();
    });
    await flushAsyncWork();

    expect(countInvocations('markets.query')).toBe(3);
    expect(latestState?.markets).toEqual([hydratedMarket]);

    await act(async () => {
      emit(
        'app.health',
        buildHealth({
          connected: true,
          mode: 'live',
          workerRunning: true,
          startupPhase: 'running',
        }),
      );
      await Promise.resolve();
    });
    await flushAsyncWork();

    expect(countInvocations('markets.query')).toBe(3);
  });

  it('re-queries the full market list when ticks arrive before any rows have been hydrated', async () => {
    const hydratedMarket = buildMarket({
      marketId: 'market-2',
      cityKey: 'new-york',
      cityName: 'New York City',
      airportCode: 'KJFK',
      yesPrice: 0.61,
    });

    queueResponses('app.getHealth', buildHealth({ startupPhase: 'starting' }));
    queueResponses(
      'app.getControlState',
      buildControlState({ startupStatus: buildStartupStatus('starting') }),
    );
    queueResponses(
      'markets.query',
      { rows: [], total: 0 } satisfies MarketQueryResult,
      { rows: [], total: 0 } satisfies MarketQueryResult,
      { rows: [hydratedMarket], total: 1 } satisfies MarketQueryResult,
    );

    await renderHarness();

    expect(countInvocations('markets.query')).toBe(2);
    expect(latestState?.markets).toEqual([]);

    await act(async () => {
      emit('markets.tick', [
        buildMarket({
          marketId: hydratedMarket.marketId,
          cityKey: hydratedMarket.cityKey,
          cityName: hydratedMarket.cityName,
          airportCode: hydratedMarket.airportCode,
          yesPrice: 0.6,
        }),
      ]);
      await vi.advanceTimersByTimeAsync(80);
    });
    await flushAsyncWork();

    expect(countInvocations('markets.query')).toBe(3);
    expect(latestState?.markets).toEqual([hydratedMarket]);
  });

  it('keeps using incremental tick updates after the market list is already populated', async () => {
    const initialMarket = buildMarket();
    const updatedMarket = buildMarket({
      marketId: initialMarket.marketId,
      yesPrice: 0.71,
      bestBid: 0.7,
      bestAsk: 0.72,
      updatedAt: '2026-04-23T00:05:00.000Z',
    });

    queueResponses(
      'app.getHealth',
      buildHealth({
        connected: true,
        mode: 'live',
        workerRunning: true,
        startupPhase: 'running',
      }),
    );
    queueResponses(
      'app.getControlState',
      buildControlState({
        coreProcessRunning: true,
        startupStatus: buildStartupStatus('ready'),
      }),
    );
    queueResponses(
      'markets.query',
      { rows: [initialMarket], total: 1 } satisfies MarketQueryResult,
      { rows: [initialMarket], total: 1 } satisfies MarketQueryResult,
    );

    await renderHarness();

    expect(countInvocations('markets.query')).toBe(2);
    expect(latestState?.markets).toEqual([initialMarket]);

    await act(async () => {
      emit('markets.tick', [updatedMarket]);
      await vi.advanceTimersByTimeAsync(80);
    });
    await flushAsyncWork();

    expect(countInvocations('markets.query')).toBe(2);
    expect(latestState?.markets).toEqual([updatedMarket]);
  });

  it('refreshes markets after importing sample city mappings successfully', async () => {
    const initialMarket = buildMarket({
      airportCode: '',
    });
    const refreshedMarket = buildMarket({
      airportCode: 'KJFK',
      cityKey: 'nyc',
      cityName: 'New York City',
      marketId: 'market-nyc',
    });

    queueResponses(
      'app.getHealth',
      buildHealth({
        connected: true,
        mode: 'live',
        workerRunning: true,
        startupPhase: 'running',
      }),
    );
    queueResponses(
      'app.getControlState',
      buildControlState({
        coreProcessRunning: true,
        startupStatus: buildStartupStatus('ready'),
      }),
    );
    queueResponses(
      'markets.query',
      { rows: [initialMarket], total: 1 } satisfies MarketQueryResult,
      { rows: [initialMarket], total: 1 } satisfies MarketQueryResult,
      { rows: [refreshedMarket], total: 1 } satisfies MarketQueryResult,
    );
    queueResponses('settings.importCityMap', { ok: true, imported: 2 });

    await renderHarness();

    expect(latestState?.markets).toEqual([initialMarket]);

    await act(async () => {
      const imported = await latestState?.importCityMap(['tokyo,RJTT,Asia/Tokyo']);
      expect(imported).toBe(2);
    });
    await flushAsyncWork();

    expect(countInvocations('settings.importCityMap')).toBe(1);
    expect(countInvocations('markets.query')).toBe(3);
    expect(latestState?.markets).toEqual([refreshedMarket]);
  });

  it('surfaces city map import failures instead of turning them into silent no-ops', async () => {
    queueResponses('app.getHealth', buildHealth());
    queueResponses('app.getControlState', buildControlState());
    queueResponses('markets.query', { rows: [], total: 0 } satisfies MarketQueryResult, {
      rows: [],
      total: 0,
    } satisfies MarketQueryResult);

    await renderHarness();

    invokeMock.mockImplementationOnce(async (channel: string) => {
      if (channel === 'settings.importCityMap') {
        throw new Error('import-failed');
      }
      throw new Error(`Unexpected invoke channel: ${channel}`);
    });

    await expect(latestState?.importCityMap(['tokyo,RJTT,Asia/Tokyo'])).rejects.toThrow(
      'import-failed',
    );
  });

  it('appends older alert pages when the alert center loads more history', async () => {
    const latestAlert = buildAlert({
      id: 'alert-3',
      triggeredAt: '2026-04-23T00:03:00.000Z',
    });
    const middleAlert = buildAlert({
      id: 'alert-2',
      triggeredAt: '2026-04-23T00:02:00.000Z',
    });
    const oldestAlert = buildAlert({
      id: 'alert-1',
      triggeredAt: '2026-04-23T00:01:00.000Z',
    });

    queueResponses('alerts.list',
      {
        rows: [latestAlert, middleAlert],
        total: 3,
        hasMore: true,
        nextCursor: {
          triggeredAt: middleAlert.triggeredAt,
          id: middleAlert.id,
        },
      } satisfies AlertListResult,
      {
        rows: [oldestAlert],
        total: 3,
        hasMore: false,
        nextCursor: {
          triggeredAt: oldestAlert.triggeredAt,
          id: oldestAlert.id,
        },
      } satisfies AlertListResult,
    );

    await renderHarness();

    expect(latestState?.alerts).toEqual([latestAlert, middleAlert]);
    expect(latestState?.alertsTotal).toBe(3);
    expect(latestState?.alertsHasMore).toBe(true);

    await act(async () => {
      await latestState?.loadMoreAlerts();
    });
    await flushAsyncWork();

    expect(countInvocations('alerts.list')).toBe(2);
    expect(latestState?.alerts).toEqual([latestAlert, middleAlert, oldestAlert]);
    expect(latestState?.alertsTotal).toBe(3);
    expect(latestState?.alertsHasMore).toBe(false);
    expect(latestState?.alertsLoadingMore).toBe(false);
    expect(latestState?.alertsLoadMoreError).toBeNull();
  });

  it('keeps the existing alert page when loading more history fails', async () => {
    const latestAlert = buildAlert({
      id: 'alert-3',
      triggeredAt: '2026-04-23T00:03:00.000Z',
    });
    const middleAlert = buildAlert({
      id: 'alert-2',
      triggeredAt: '2026-04-23T00:02:00.000Z',
    });

    queueResponses(
      'alerts.list',
      {
        rows: [latestAlert, middleAlert],
        total: 3,
        hasMore: true,
        nextCursor: {
          triggeredAt: middleAlert.triggeredAt,
          id: middleAlert.id,
        },
      } satisfies AlertListResult,
      new Error('load-more-failed'),
    );

    await renderHarness();

    expect(latestState?.alerts).toEqual([latestAlert, middleAlert]);
    expect(latestState?.alertsTotal).toBe(3);
    expect(latestState?.alertsHasMore).toBe(true);

    await act(async () => {
      await latestState?.loadMoreAlerts();
      await Promise.resolve();
    });
    await flushAsyncWork();

    expect(countInvocations('alerts.list')).toBe(2);
    expect(latestState?.alerts).toEqual([latestAlert, middleAlert]);
    expect(latestState?.alertsTotal).toBe(3);
    expect(latestState?.alertsHasMore).toBe(true);
    expect(latestState?.alertsLoadingMore).toBe(false);
    expect(latestState?.alertsLoadMoreError).toBe('load-more-failed');
  });

  it('preserves the current alert list when refreshAll cannot refresh alerts', async () => {
    const latestAlert = buildAlert({
      id: 'alert-3',
      triggeredAt: '2026-04-23T00:03:00.000Z',
    });
    const middleAlert = buildAlert({
      id: 'alert-2',
      triggeredAt: '2026-04-23T00:02:00.000Z',
    });
    const refreshedMarket = buildMarket({
      marketId: 'market-2',
      cityKey: 'new-york',
      cityName: 'New York City',
      airportCode: 'KJFK',
      yesPrice: 0.61,
    });

    queueResponses(
      'alerts.list',
      {
        rows: [latestAlert, middleAlert],
        total: 3,
        hasMore: true,
        nextCursor: {
          triggeredAt: middleAlert.triggeredAt,
          id: middleAlert.id,
        },
      } satisfies AlertListResult,
    );

    await renderHarness();

    queueResponses(
      'markets.query',
      { rows: [refreshedMarket], total: 1 } satisfies MarketQueryResult,
    );
    queueResponses('alerts.list', new Error('refresh-alerts-failed'));

    await act(async () => {
      await latestState?.refreshAll();
      await Promise.resolve();
    });
    await flushAsyncWork();

    expect(countInvocations('alerts.list')).toBe(2);
    expect(latestState?.alerts).toEqual([latestAlert, middleAlert]);
    expect(latestState?.alertsTotal).toBe(3);
    expect(latestState?.alertsHasMore).toBe(true);
    expect(latestState?.alertsLoadMoreError).toBe('refresh-alerts-failed');
    expect(latestState?.markets).toEqual([refreshedMarket]);
  });

  it('prepends real-time alerts without dropping the existing loaded page', async () => {
    const firstAlert = buildAlert({
      id: 'alert-2',
      triggeredAt: '2026-04-23T00:02:00.000Z',
    });
    const secondAlert = buildAlert({
      id: 'alert-1',
      triggeredAt: '2026-04-23T00:01:00.000Z',
    });
    const incomingAlert = buildAlert({
      id: 'alert-3',
      triggeredAt: '2026-04-23T00:03:00.000Z',
      severity: 'critical',
    });

    queueResponses(
      'alerts.list',
      {
        rows: [firstAlert, secondAlert],
        total: 2,
        hasMore: false,
      } satisfies AlertListResult,
    );

    await renderHarness();

    await act(async () => {
      emit('alerts.new', incomingAlert);
      await vi.advanceTimersByTimeAsync(120);
    });
    await flushAsyncWork();

    expect(latestState?.alerts).toEqual([incomingAlert, firstAlert, secondAlert]);
    expect(latestState?.alertsTotal).toBe(3);
    expect(latestState?.alertsHasMore).toBe(false);
  });

  it('batches burst alert events before publishing the next alert frame', async () => {
    const firstAlert = buildAlert({
      id: 'alert-2',
      triggeredAt: '2026-04-23T00:02:00.000Z',
    });
    const secondAlert = buildAlert({
      id: 'alert-1',
      triggeredAt: '2026-04-23T00:01:00.000Z',
    });
    const incomingAlertA = buildAlert({
      id: 'alert-3',
      triggeredAt: '2026-04-23T00:03:00.000Z',
      severity: 'critical',
    });
    const incomingAlertB = buildAlert({
      id: 'alert-4',
      triggeredAt: '2026-04-23T00:04:00.000Z',
      severity: 'warning',
    });

    queueResponses(
      'alerts.list',
      {
        rows: [firstAlert, secondAlert],
        total: 2,
        hasMore: false,
      } satisfies AlertListResult,
    );

    await renderHarness();

    await act(async () => {
      emit('alerts.new', incomingAlertA);
      emit('alerts.new', incomingAlertB);
      await Promise.resolve();
    });

    expect(latestState?.alerts).toEqual([firstAlert, secondAlert]);
    expect(latestState?.alertsTotal).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    await flushAsyncWork();

    expect(latestState?.alerts).toEqual([incomingAlertB, incomingAlertA, firstAlert, secondAlert]);
    expect(latestState?.alertsTotal).toBe(4);
    expect(latestState?.alertsHasMore).toBe(false);
  });

  it('creates a storage backup and refreshes the storage summary state', async () => {
    const nextStorageSummary = buildStorageSummary();
    nextStorageSummary.mainDbSizeBytes = 2_048;

    queueResponses(
      'storage.createBackup',
      buildStorageBackupResult({
        storageSummary: nextStorageSummary,
      }),
    );

    await renderHarness();

    let result: StorageBackupResult | undefined;
    await act(async () => {
      result = await latestState?.createStorageBackup();
      await Promise.resolve();
    });
    await flushAsyncWork();

    expect(countInvocations('storage.createBackup')).toBe(1);
    expect(result?.backupPath).toContain('main-backup-');
    expect(latestState?.storageSummary?.mainDbSizeBytes).toBe(2_048);
    expect(latestState?.storageSummary?.latestMainBackupPath).toBe(
      nextStorageSummary.latestMainBackupPath,
    );
    expect(latestState?.storageSummary?.latestMainBackupAt).toBe(
      nextStorageSummary.latestMainBackupAt,
    );
  });

  it('clears storage cache and refreshes the storage summary state', async () => {
    const nextStorageSummary = buildStorageSummary({
      cleanableSizeBytes: 0,
      canClearCache: false,
      lastCleanupAt: '2026-04-24T02:00:00.000Z',
    });

    queueResponses(
      'storage.clearCache',
      buildStorageCleanupResult({
        storageSummary: nextStorageSummary,
      }),
    );

    await renderHarness();

    let result: StorageCleanupResult | undefined;
    await act(async () => {
      result = await latestState?.clearStorageCache();
      await Promise.resolve();
    });
    await flushAsyncWork();

    expect(countInvocations('storage.clearCache')).toBe(1);
    expect(result?.reclaimedBytes).toBe(768);
    expect(latestState?.storageSummary?.cleanableSizeBytes).toBe(0);
    expect(latestState?.storageSummary?.canClearCache).toBe(false);
    expect(latestState?.storageSummary?.lastCleanupAt).toBe(nextStorageSummary.lastCleanupAt);
  });

  it('runs storage maintenance and refreshes maintenance summary state', async () => {
    const nextStorageSummary = buildStorageSummary({
      mainDbSizeBytes: 1536,
    });

    queueResponses(
      'storage.runMaintenance',
      buildStorageMaintenanceResult({
        summary: buildStorageMaintenanceSummary({
          status: 'success',
          lastRunAt: '2026-04-24T03:00:00.000Z',
          lastSuccessAt: '2026-04-24T03:00:00.000Z',
          lastDurationMs: 510,
          lastArchivedRows: 320,
          lastPrunedTickRows: 320,
          lastPrunedAlertRows: 8,
          lastCheckpointAt: '2026-04-24T03:00:00.000Z',
          lastReason: 'manual',
        }),
        storageSummary: nextStorageSummary,
      }),
    );

    await renderHarness();

    let result: StorageMaintenanceResult | undefined;
    await act(async () => {
      result = await latestState?.runStorageMaintenance();
      await Promise.resolve();
    });
    await flushAsyncWork();

    expect(countInvocations('storage.runMaintenance')).toBe(1);
    expect(result?.summary.lastArchivedRows).toBe(320);
    expect(latestState?.storageMaintenance?.lastPrunedAlertRows).toBe(8);
    expect(latestState?.storageSummary?.mainDbSizeBytes).toBe(1536);
  });
});
