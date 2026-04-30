import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MessageChannel } from 'node:worker_threads';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/db/repository', () => {
  class WeatherMonitorRepository {
    private readonly settings = new Map<string, { key: string; value: string; updatedAt: number }>([
      ['tickRetentionDays', { key: 'tickRetentionDays', value: '7', updatedAt: 0 }],
      ['alertRetentionDays', { key: 'alertRetentionDays', value: '90', updatedAt: 0 }],
      ['startOnBoot', { key: 'startOnBoot', value: 'false', updatedAt: 0 }],
      ['backgroundAudio', { key: 'backgroundAudio', value: 'true', updatedAt: 0 }],
      ['reconnectPolicy', { key: 'reconnectPolicy', value: 'balanced', updatedAt: 0 }],
      ['pollIntervalSec', { key: 'pollIntervalSec', value: '60', updatedAt: 0 }],
      ['selectedSoundProfileId', { key: 'selectedSoundProfileId', value: '', updatedAt: 0 }],
      ['quietHoursStart', { key: 'quietHoursStart', value: '23:00', updatedAt: 0 }],
      ['quietHoursEnd', { key: 'quietHoursEnd', value: '06:00', updatedAt: 0 }],
    ]);

    archivePriceTicks = vi.fn(() => ({ archivedRows: 0, prunedRows: 0 }));
    insertPriceTicks = vi.fn(() => undefined);
    prunePriceTicks = vi.fn(() => 0);
    pruneAlertEvents = vi.fn(() => 0);
    queryRecentAlertEventsForScoring = vi.fn(() => []);
    checkpointWal = vi.fn(() => undefined);
    compactDatabase = vi.fn(() => undefined);

    init(): void {
      return undefined;
    }

    seedDefaults(): void {
      return undefined;
    }

    queryAppSetting(key: string) {
      return this.settings.get(key);
    }

    upsertAppSetting(item: { key: string; value: string; updatedAt?: number }): void {
      this.settings.set(item.key, {
        key: item.key,
        value: item.value,
        updatedAt: item.updatedAt ?? 0,
      });
    }

    querySoundProfiles(): never[] {
      return [];
    }
  }

  return { WeatherMonitorRepository };
});

vi.mock('../../src/core/services/polymarket-data-service', () => {
  class PolymarketDataService {
    on(): this {
      return this;
    }

    getState() {
      return {
        shardStates: [],
        universe: null,
      };
    }

    async start(): Promise<void> {
      return undefined;
    }

    async stop(): Promise<void> {
      return undefined;
    }
  }

  return { PolymarketDataService };
});

import { WorkerRuntime } from '../../src/core/worker-runtime';

const createdRuntimes: any[] = [];
const FIXED_NOW = new Date('2026-04-24T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_BATCH_SIZE = 50_000;

const createRuntime = () => {
  const { port1, port2 } = new MessageChannel();
  const runtime = new WorkerRuntime(port1, {
    dbPath: path.join(tmpdir(), `weather-monitor-${randomUUID()}.sqlite`),
  });
  port2.close();
  createdRuntimes.push(runtime);
  return runtime as any;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  for (const runtime of createdRuntimes.splice(0)) {
    if (runtime.maintenanceTimer) {
      clearInterval(runtime.maintenanceTimer);
    }
    runtime.port?.close?.();
  }
  vi.useRealTimers();
});

const expectArchiveQuery = (
  runtime: any,
  callIndex: number,
  retentionDays: number,
  nowMs = Date.now(),
) => {
  const actual = runtime.repository.archivePriceTicks.mock.calls[callIndex]?.[0];
  expect(actual?.batchSize).toBe(ARCHIVE_BATCH_SIZE);
  expect(Math.abs((actual?.cutoffTimestamp ?? 0) - (nowMs - retentionDays * DAY_MS))).toBeLessThanOrEqual(5);
};

describe('worker runtime tick retention', () => {
  it('flushes pending ticks before archive maintenance starts', async () => {
    const runtime = createRuntime();
    const pendingTick = {
      tokenId: 'token-1',
      marketId: 'market-1',
      cityKey: 'sha',
      eventId: 'event-1',
      price: 0.62,
      timestamp: Date.now(),
    };

    runtime.pendingPriceTicks.push(pendingTick);
    runtime.repository.archivePriceTicks.mockReturnValueOnce({
      archivedRows: 1,
      prunedRows: 1,
    });

    runtime.startMaintenanceLoop();
    expect(runtime.repository.insertPriceTicks).not.toHaveBeenCalled();
    expect(runtime.repository.archivePriceTicks).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(runtime.repository.insertPriceTicks).toHaveBeenCalledTimes(1);
    expect(runtime.repository.insertPriceTicks).toHaveBeenCalledWith([pendingTick]);
    expect(runtime.repository.archivePriceTicks).toHaveBeenCalledTimes(1);
    expectArchiveQuery(runtime, 0, 7);
    expect(runtime.repository.insertPriceTicks.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.repository.archivePriceTicks.mock.invocationCallOrder[0],
    );
    expect(runtime.repository.prunePriceTicks).not.toHaveBeenCalled();
  });

  it('archives tick history after the startup maintenance delay', async () => {
    const runtime = createRuntime();

    runtime.repository.archivePriceTicks.mockReturnValueOnce({
      archivedRows: 24,
      prunedRows: 24,
      aggregateRows: 1,
    });
    runtime.repository.upsertAppSetting({
      key: 'tickRetentionDays',
      value: '12',
      updatedAt: 0,
    });

    runtime.startMaintenanceLoop();
    expect(runtime.repository.archivePriceTicks).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(runtime.repository.archivePriceTicks).toHaveBeenCalledTimes(1);
    expectArchiveQuery(runtime, 0, 12);
    expect(runtime.repository.prunePriceTicks).not.toHaveBeenCalled();
    expect(runtime.repository.pruneAlertEvents).toHaveBeenCalledTimes(1);
    expect(runtime.repository.pruneAlertEvents).toHaveBeenCalledWith(90);
    expect(runtime.repository.checkpointWal).toHaveBeenCalledTimes(1);
    expect(runtime.repository.compactDatabase).not.toHaveBeenCalled();
  });

  it('checkpoints the database after a large delayed startup archive prune', async () => {
    const runtime = createRuntime();

    runtime.repository.archivePriceTicks.mockReturnValueOnce({
      archivedRows: 12_000,
      prunedRows: 12_000,
    });

    runtime.startMaintenanceLoop();
    expect(runtime.repository.archivePriceTicks).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(runtime.repository.archivePriceTicks).toHaveBeenCalledTimes(1);
    expectArchiveQuery(runtime, 0, 7);
    expect(runtime.repository.prunePriceTicks).not.toHaveBeenCalled();
    expect(runtime.repository.pruneAlertEvents).toHaveBeenCalledTimes(1);
    expect(runtime.repository.compactDatabase).not.toHaveBeenCalled();
    expect(runtime.repository.checkpointWal).toHaveBeenCalledTimes(1);
  });

  it('archives tick history immediately when retention changes', () => {
    const runtime = createRuntime();

    runtime.repository.archivePriceTicks.mockReturnValueOnce({
      archivedRows: 12_000,
      prunedRows: 12_000,
    });
    vi.spyOn(runtime, 'refreshRulesSync').mockImplementation(() => undefined);
    vi.spyOn(runtime, 'getSettingsPayload').mockReturnValue({
      settings: {
        startOnBoot: false,
        backgroundAudio: true,
        reconnectPolicy: 'balanced',
        pollIntervalSec: 60,
        tickRetentionDays: 3,
        alertRetentionDays: 90,
        selectedSoundProfileId: '',
        quietHoursStart: '23:00',
        quietHoursEnd: '06:00',
      },
      soundProfiles: [],
    });

    runtime.updateSettings({ tickRetentionDays: 3 });

    expect(runtime.repository.archivePriceTicks).toHaveBeenCalledTimes(1);
    expectArchiveQuery(runtime, 0, 3);
    expect(runtime.repository.pruneAlertEvents).toHaveBeenCalledTimes(1);
    expect(runtime.repository.pruneAlertEvents).toHaveBeenCalledWith(90);
    expect(runtime.repository.prunePriceTicks).not.toHaveBeenCalled();
    expect(runtime.repository.compactDatabase).toHaveBeenCalledTimes(1);
    expect(runtime.repository.checkpointWal).not.toHaveBeenCalled();
    expect(runtime.repository.queryAppSetting('tickRetentionDays')?.value).toBe('3');
  });

  it('registers recurring archive maintenance after startup', async () => {
    const runtime = createRuntime();

    runtime.startMaintenanceLoop();
    await vi.advanceTimersByTimeAsync(15_000);
    await runtime.maintenanceInFlight;
    expect(runtime.maintenanceTimer).toBeDefined();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it('does not run tick archive maintenance when retention is unchanged', () => {
    const runtime = createRuntime();

    vi.spyOn(runtime, 'refreshRulesSync').mockImplementation(() => undefined);
    vi.spyOn(runtime, 'getSettingsPayload').mockReturnValue({
      settings: {
        startOnBoot: false,
        backgroundAudio: false,
        reconnectPolicy: 'balanced',
        pollIntervalSec: 60,
        tickRetentionDays: 7,
        alertRetentionDays: 90,
        selectedSoundProfileId: '',
        quietHoursStart: '23:00',
        quietHoursEnd: '06:00',
      },
      soundProfiles: [],
    });

    runtime.updateSettings({ backgroundAudio: false });

    expect(runtime.repository.archivePriceTicks).not.toHaveBeenCalled();
    expect(runtime.repository.prunePriceTicks).not.toHaveBeenCalled();
    expect(runtime.repository.pruneAlertEvents).not.toHaveBeenCalled();
    expect(runtime.repository.compactDatabase).not.toHaveBeenCalled();
    expect(runtime.repository.checkpointWal).not.toHaveBeenCalled();
    expect(runtime.repository.queryAppSetting('backgroundAudio')?.value).toBe('false');
  });

  it('continues draining archive batches while the repository reports remaining backlog', async () => {
    const runtime = createRuntime();

    runtime.repository.archivePriceTicks
      .mockReturnValueOnce({
        archivedRows: 50_000,
        prunedRows: 50_000,
        aggregateRows: 800,
        hasMore: true,
      })
      .mockReturnValueOnce({
        archivedRows: 12_000,
        prunedRows: 12_000,
        aggregateRows: 240,
        hasMore: false,
      });

    runtime.startMaintenanceLoop();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(runtime.repository.archivePriceTicks).toHaveBeenCalledTimes(2);
    expectArchiveQuery(runtime, 0, 7);
    expectArchiveQuery(runtime, 1, 7);
    expect(runtime.repository.prunePriceTicks).not.toHaveBeenCalled();
    expect(runtime.repository.compactDatabase).not.toHaveBeenCalled();
    expect(runtime.repository.checkpointWal).toHaveBeenCalledTimes(1);
  });
});
