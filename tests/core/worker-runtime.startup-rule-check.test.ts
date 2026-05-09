import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MessageChannel } from 'node:worker_threads';

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/db/repository', () => {
  class WeatherMonitorRepository {
    init(): void {
      return undefined;
    }
    seedDefaults(): void {
      return undefined;
    }
    queryCityConfigs(): never[] {
      return [];
    }
    upsertCityConfigs(): void {
      return undefined;
    }
    queryAlertRules(): never[] {
      return [];
    }
    upsertAlertRules(): void {
      return undefined;
    }
    upsertSoundProfiles(): void {
      return undefined;
    }
    querySoundProfiles(): never[] {
      return [];
    }
    queryTrackedMarkets(): never[] {
      return [];
    }
    queryLatestTokenStates(): never[] {
      return [];
    }
    upsertLatestTokenStates(): void {
      return undefined;
    }
    insertAlertEvents(): void {
      return undefined;
    }
    queryRecentAlertEventsForScoring(): never[] {
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

import type { AlertRule as EngineAlertRule } from '../../src/core/alerts/types';
import { WorkerRuntime } from '../../src/core/worker-runtime';

type RuntimeUnderTest = {
  serviceStarted: boolean;
  hasSuccessfulDiscovery: boolean;
  startupRuleCheckCompleted: boolean;
  engineRules: EngineAlertRule[];
  latestTokenStateById: Map<string, Record<string, unknown>>;
  tokenMetaById: Map<string, Record<string, unknown>>;
  trackedMarketById: Map<string, Record<string, unknown>>;
  cityByKey: Map<string, Record<string, unknown>>;
  alertEngine: {
    evaluateMarketTick: (...args: unknown[]) => unknown[];
  };
  marketState: {
    recordTick: (...args: unknown[]) => void;
  };
  feedState: {
    upsert: (state: Record<string, unknown>) => void;
  };
  maybeRunStartupRuleCheck: (nowMs: number) => void;
  runCurrentRuleCheck: (
    maxAlerts: number,
    options?: {
      nowMs?: number;
      source?: string;
      latestStateFilter?: (state: { lastMessageAt: number }) => boolean;
    },
  ) => void;
  persistAndEmitAlerts: (...args: unknown[]) => void;
  handleTokenState: (state: Record<string, unknown>) => Promise<void>;
};

const createRuntime = () => {
  const { port1, port2 } = new MessageChannel();
  const runtime = new WorkerRuntime(port1, {
    dbPath: path.join(tmpdir(), `weather-monitor-${randomUUID()}.sqlite`),
  }) as unknown as RuntimeUnderTest;
  port2.close();
  return runtime;
};

const createRule = (metric: EngineAlertRule['metric']): EngineAlertRule => ({
  id: `rule-${metric}`,
  name: metric,
  enabled: true,
  metric,
  operator: metric === 'feed_stale' ? '>=' : '>=',
  threshold: metric === 'feed_stale' ? 30 : 0.6,
  windowSec: 300,
  cooldownSec: 0,
  dedupeWindowSec: 0,
  severity: 'medium',
});

describe('worker runtime startup rule check', () => {
  it('waits for discovery before running the startup scan and only runs once', () => {
    const runtime = createRuntime();
    const now = Date.UTC(2026, 3, 23, 9, 0, 0);
    const runCurrentRuleCheck = vi
      .spyOn(runtime, 'runCurrentRuleCheck')
      .mockImplementation(() => undefined);

    runtime.serviceStarted = true;
    runtime.engineRules = [createRule('price_threshold')];
    runtime.latestTokenStateById = new Map([
      [
        'token-1',
        {
          tokenId: 'token-1',
          marketId: 'market-1',
          side: 'yes',
          lastTradePrice: 0.72,
          bestBid: 0.7,
          bestAsk: 0.74,
          spread: 0.04,
          lastMessageAt: now - 1_000,
          updatedAt: now - 1_000,
        },
      ],
    ]);

    runtime.maybeRunStartupRuleCheck(now);
    expect(runCurrentRuleCheck).not.toHaveBeenCalled();

    runtime.hasSuccessfulDiscovery = true;
    runtime.maybeRunStartupRuleCheck(now);
    expect(runCurrentRuleCheck).toHaveBeenCalledTimes(1);
    expect(runCurrentRuleCheck).toHaveBeenCalledWith(80, expect.objectContaining({
      source: 'startup-scan',
    }));

    runtime.maybeRunStartupRuleCheck(now + 5_000);
    expect(runCurrentRuleCheck).toHaveBeenCalledTimes(1);
    expect(runtime.startupRuleCheckCompleted).toBe(true);
  });

  it('does not arm the startup scan from stale market snapshots', () => {
    const runtime = createRuntime();
    const now = Date.UTC(2026, 3, 23, 9, 0, 0);
    const runCurrentRuleCheck = vi
      .spyOn(runtime, 'runCurrentRuleCheck')
      .mockImplementation(() => undefined);

    runtime.serviceStarted = true;
    runtime.hasSuccessfulDiscovery = true;
    runtime.engineRules = [createRule('price_threshold')];
    runtime.latestTokenStateById = new Map([
      [
        'token-1',
        {
          tokenId: 'token-1',
          marketId: 'market-1',
          side: 'yes',
          lastTradePrice: 0.72,
          bestBid: 0.7,
          bestAsk: 0.74,
          spread: 0.04,
          lastMessageAt: now - 91_000,
          updatedAt: now - 91_000,
        },
      ],
    ]);

    runtime.maybeRunStartupRuleCheck(now);
    expect(runCurrentRuleCheck).not.toHaveBeenCalled();
    expect(runtime.startupRuleCheckCompleted).toBe(false);
  });

  it('filters stale latest states out of the startup current scan', () => {
    const runtime = createRuntime();
    const now = Date.UTC(2026, 3, 23, 9, 0, 0);
    const evaluateMarketTick = vi
      .spyOn(runtime.alertEngine, 'evaluateMarketTick')
      .mockReturnValue([]);
    vi.spyOn(runtime, 'persistAndEmitAlerts').mockImplementation(() => undefined);

    runtime.engineRules = [createRule('price_threshold')];
    runtime.latestTokenStateById = new Map([
      [
        'fresh-token',
        {
          tokenId: 'fresh-token',
          marketId: 'market-1',
          side: 'yes',
          lastTradePrice: 0.72,
          bestBid: 0.7,
          bestAsk: 0.74,
          spread: 0.04,
          lastMessageAt: now - 1_000,
          updatedAt: now - 1_000,
        },
      ],
      [
        'stale-token',
        {
          tokenId: 'stale-token',
          marketId: 'market-2',
          side: 'yes',
          lastTradePrice: 0.81,
          bestBid: 0.79,
          bestAsk: 0.83,
          spread: 0.04,
          lastMessageAt: now - 91_000,
          updatedAt: now - 91_000,
        },
      ],
    ]);
    runtime.tokenMetaById = new Map([
      [
        'fresh-token',
        {
          marketId: 'market-1',
          cityKey: 'la',
          eventId: 'event-1',
          eventDate: '2026-04-23',
          temperatureBand: '70°F to 71°F',
          seriesSlug: 'weather-la',
          side: 'yes',
        },
      ],
      [
        'stale-token',
        {
          marketId: 'market-2',
          cityKey: 'nyc',
          eventId: 'event-2',
          eventDate: '2026-04-23',
          temperatureBand: '68°F to 69°F',
          seriesSlug: 'weather-nyc',
          side: 'yes',
        },
      ],
    ]);

    runtime.runCurrentRuleCheck(80, {
      nowMs: now,
      latestStateFilter: (state: { lastMessageAt: number }) => now - state.lastMessageAt <= 90_000,
    });

    expect(evaluateMarketTick).toHaveBeenCalledTimes(1);
    const firstInput = evaluateMarketTick.mock.calls[0]?.[1] as { tokenId: string } | undefined;
    expect(firstInput?.tokenId).toBe('fresh-token');
  });

  it('allows a feed-only startup scan without waiting for market ticks', () => {
    const runtime = createRuntime();
    const now = Date.UTC(2026, 3, 23, 9, 0, 0);
    const runCurrentRuleCheck = vi
      .spyOn(runtime, 'runCurrentRuleCheck')
      .mockImplementation(() => undefined);

    runtime.serviceStarted = true;
    runtime.hasSuccessfulDiscovery = true;
    runtime.engineRules = [createRule('feed_stale')];
    runtime.feedState.upsert({
      feedKey: 'market-ws-shard-1',
      status: 'degraded',
      lastMessageAt: now - 35_000,
      updatedAt: now,
    });

    runtime.maybeRunStartupRuleCheck(now);
    expect(runCurrentRuleCheck).toHaveBeenCalledTimes(1);
  });

  it('seeds discovery snapshots into market history without emitting fresh alerts', async () => {
    const runtime = createRuntime();
    const now = Date.UTC(2026, 3, 23, 9, 0, 0);
    const evaluateMarketTick = vi
      .spyOn(runtime.alertEngine, 'evaluateMarketTick')
      .mockReturnValue([]);
    const recordTick = vi.spyOn(runtime.marketState, 'recordTick');

    runtime.tokenMetaById = new Map([
      [
        'token-1',
        {
          marketId: 'market-1',
          cityKey: 'la',
          eventId: 'event-1',
          eventDate: '2026-04-23',
          temperatureBand: '70F to 71F',
          seriesSlug: 'weather-la',
          side: 'yes',
        },
      ],
    ]);

    await runtime.handleTokenState({
      tokenId: 'token-1',
      lastTradePrice: 0.72,
      bestBid: 0.7,
      bestAsk: 0.74,
      spread: 0.04,
      updatedAt: now,
      lastEventType: 'discovery',
    });

    expect(evaluateMarketTick).not.toHaveBeenCalled();
    expect(recordTick).toHaveBeenCalledTimes(1);
  });

  it('uses the first live tick as a baseline before realtime alerting starts', async () => {
    const runtime = createRuntime();
    const now = Date.UTC(2026, 3, 23, 9, 0, 0);
    const evaluateMarketTick = vi
      .spyOn(runtime.alertEngine, 'evaluateMarketTick')
      .mockReturnValue([]);
    const recordTick = vi.spyOn(runtime.marketState, 'recordTick');

    runtime.tokenMetaById = new Map([
      [
        'token-1',
        {
          marketId: 'market-1',
          cityKey: 'la',
          eventId: 'event-1',
          eventDate: '2026-04-23',
          temperatureBand: '70F to 71F',
          seriesSlug: 'weather-la',
          side: 'yes',
        },
      ],
    ]);

    await runtime.handleTokenState({
      tokenId: 'token-1',
      lastTradePrice: 0.72,
      bestBid: 0.7,
      bestAsk: 0.74,
      spread: 0.04,
      updatedAt: now,
      lastEventType: 'best_bid_ask',
    });
    await runtime.handleTokenState({
      tokenId: 'token-1',
      lastTradePrice: 0.73,
      bestBid: 0.71,
      bestAsk: 0.75,
      spread: 0.04,
      updatedAt: now + 1_000,
      lastEventType: 'best_bid_ask',
    });

    expect(recordTick).toHaveBeenCalledTimes(1);
    expect(evaluateMarketTick).toHaveBeenCalledTimes(1);
  });

  it('adds a temperature ladder kill signal after adjacent higher bands confirm the move', async () => {
    const runtime = createRuntime();
    const now = Date.UTC(2026, 4, 9, 13, 32, 0);
    const evaluateMarketTick = vi
      .spyOn(runtime.alertEngine, 'evaluateMarketTick')
      .mockReturnValue([]);

    runtime.cityByKey = new Map([
      ['warsaw', { cityKey: 'warsaw', displayName: 'Warsaw', airportCode: 'EPWA' }],
    ]);
    runtime.trackedMarketById = new Map([
      [
        'warsaw-13c',
        {
          marketId: 'warsaw-13c',
          eventId: 'event-warsaw',
          cityKey: 'warsaw',
          seriesSlug: 'warsaw-weather',
          eventDate: '2026-05-09',
          groupItemTitle: '13°C',
          tokenYesId: 'warsaw-13c-yes',
          tokenNoId: 'warsaw-13c-no',
          active: true,
          closed: false,
          pinned: false,
          updatedAt: now - 60_000,
        },
      ],
      [
        'warsaw-14c',
        {
          marketId: 'warsaw-14c',
          eventId: 'event-warsaw',
          cityKey: 'warsaw',
          seriesSlug: 'warsaw-weather',
          eventDate: '2026-05-09',
          groupItemTitle: '14°C',
          tokenYesId: 'warsaw-14c-yes',
          tokenNoId: 'warsaw-14c-no',
          active: true,
          closed: false,
          pinned: false,
          updatedAt: now - 60_000,
        },
      ],
    ]);
    runtime.tokenMetaById = new Map([
      [
        'warsaw-13c-yes',
        {
          marketId: 'warsaw-13c',
          cityKey: 'warsaw',
          eventId: 'event-warsaw',
          eventDate: '2026-05-09',
          temperatureBand: '13°C',
          seriesSlug: 'warsaw-weather',
          side: 'yes',
        },
      ],
      [
        'warsaw-14c-yes',
        {
          marketId: 'warsaw-14c',
          cityKey: 'warsaw',
          eventId: 'event-warsaw',
          eventDate: '2026-05-09',
          temperatureBand: '14°C',
          seriesSlug: 'warsaw-weather',
          side: 'yes',
        },
      ],
    ]);
    runtime.latestTokenStateById = new Map([
      [
        'warsaw-14c-yes',
        {
          tokenId: 'warsaw-14c-yes',
          marketId: 'warsaw-14c',
          side: 'yes',
          lastTradePrice: 0.68,
          bestBid: 0.66,
          bestAsk: 0.7,
          spread: 0.04,
          lastMessageAt: now,
          updatedAt: now,
        },
      ],
    ]);

    await runtime.handleTokenState({
      tokenId: 'warsaw-13c-yes',
      lastTradePrice: 0.102,
      bestBid: 0.1,
      bestAsk: 0.12,
      spread: 0.02,
      bidLevelCount: 1,
      updatedAt: now - 20_000,
      lastEventType: 'best_bid_ask',
    });
    await runtime.handleTokenState({
      tokenId: 'warsaw-13c-yes',
      bestBid: 0,
      bidLevelCount: 0,
      bidVisibleSize: 0,
      removedBidEdge: {
        previousPrice: 0.102,
        previousSize: 40,
        currentPrice: null,
        currentSize: 0,
        levelCountAfter: 0,
        visibleSizeAfter: 0,
        source: 'book',
      },
      updatedAt: now,
      lastEventType: 'price_change',
    });

    expect(evaluateMarketTick).toHaveBeenCalledTimes(1);
    const input = evaluateMarketTick.mock.calls[0]?.[1] as {
      liquidityKillSignal?: Record<string, unknown>;
    };
    expect(input.liquidityKillSignal).toMatchObject({
      direction: 'higher',
      previousPrice: 0.102,
      currentPrice: 0,
      source: 'temperature_ladder',
      reason: 'temperature_ladder_high',
      confirmationMarketId: 'warsaw-14c',
    });
  });
});
