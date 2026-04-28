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

const createRuntime = () => {
  const { port1, port2 } = new MessageChannel();
  const runtime = new WorkerRuntime(port1, {
    dbPath: path.join(tmpdir(), `weather-monitor-${randomUUID()}.sqlite`),
  });
  port2.close();
  return runtime as any;
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
});
