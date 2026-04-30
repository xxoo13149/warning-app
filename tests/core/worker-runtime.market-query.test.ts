import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MessageChannel } from 'node:worker_threads';

import { afterEach, describe, expect, it, vi } from 'vitest';

const { queryRecentAlertEventsForScoringMock } = vi.hoisted(() => ({
  queryRecentAlertEventsForScoringMock: vi.fn<() => Array<Record<string, unknown>>>(() => []),
}));

vi.mock('../../src/core/db/repository', () => {
  class WeatherMonitorRepository {
    queryRecentAlertEventsForScoring = queryRecentAlertEventsForScoringMock;
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
  }

  return { PolymarketDataService };
});

import { WorkerRuntime } from '../../src/core/worker-runtime';

const createdRuntimes: any[] = [];

const createRuntime = () => {
  const { port1, port2 } = new MessageChannel();
  const runtime = new WorkerRuntime(port1, {
    dbPath: path.join(tmpdir(), `weather-monitor-${randomUUID()}.sqlite`),
  });
  port2.close();
  createdRuntimes.push(runtime);
  return runtime as any;
};

const buildCity = (overrides: Record<string, unknown> = {}) => ({
  cityKey: 'los-angeles',
  displayName: 'Los Angeles',
  seriesSlug: 'los-angeles-daily-weather',
  airportCode: 'KLAX',
  timezone: 'America/Los_Angeles',
  enabled: true,
  resolutionSourceOverride: null,
  updatedAt: Date.UTC(2026, 3, 25),
  ...overrides,
});

const buildMarket = (overrides: Record<string, unknown> = {}) => ({
  marketId: 'market-la',
  eventId: 'event-la',
  cityKey: 'los-angeles',
  seriesSlug: 'los-angeles-daily-weather',
  eventDate: '2030-04-26',
  conditionId: 'condition-la',
  groupItemTitle: '70F to 71F',
  tokenYesId: 'yes-la',
  tokenNoId: 'no-la',
  active: true,
  closed: false,
  pinned: false,
  updatedAt: Date.UTC(2026, 3, 25, 10),
  ...overrides,
});

const seedRuntime = (
  runtime: any,
  markets: Array<ReturnType<typeof buildMarket>>,
  cities: Array<ReturnType<typeof buildCity>>,
) => {
  runtime.trackedMarketById = new Map(markets.map((market) => [market.marketId, market]));
  runtime.cityByKey = new Map(cities.map((city) => [city.cityKey, city]));
  runtime.latestTokenStateById = new Map();
};

afterEach(() => {
  queryRecentAlertEventsForScoringMock.mockReset();
  queryRecentAlertEventsForScoringMock.mockImplementation(() => []);
  for (const runtime of createdRuntimes.splice(0)) {
    if (runtime.bubbleScoreTimer) {
      clearInterval(runtime.bubbleScoreTimer);
    }
    runtime.port?.close?.();
  }
  vi.useRealTimers();
});

describe('WorkerRuntime market query', () => {
  it('matches Market Explorer search across city key, city name, airport code, and Chinese name', () => {
    const runtime = createRuntime();
    seedRuntime(
      runtime,
      [
        buildMarket(),
        buildMarket({
          marketId: 'market-shanghai',
          eventId: 'event-shanghai',
          cityKey: 'shanghai',
          seriesSlug: 'shanghai-daily-weather',
          tokenYesId: 'yes-shanghai',
          tokenNoId: 'no-shanghai',
        }),
        buildMarket({
          marketId: 'market-guangzhou',
          eventId: 'event-guangzhou',
          cityKey: 'guangzhou',
          seriesSlug: 'guangzhou-daily-weather',
          tokenYesId: 'yes-guangzhou',
          tokenNoId: 'no-guangzhou',
        }),
      ],
      [
        buildCity(),
        buildCity({
          cityKey: 'shanghai',
          displayName: '上海',
          seriesSlug: 'shanghai-daily-weather',
          airportCode: 'ZSPD',
          timezone: 'Asia/Shanghai',
        }),
        buildCity({
          cityKey: 'guangzhou',
          displayName: 'Guangzhou',
          seriesSlug: 'guangzhou-daily-weather',
          airportCode: '',
          timezone: 'Asia/Shanghai',
        }),
      ],
    );

    expect(
      runtime.queryMarkets({ cityKey: '上海' }).rows.map((row: { marketId: string }) => row.marketId),
    ).toEqual(['market-shanghai']);
    expect(runtime.queryMarkets({ cityKey: 'zspd' }).rows[0]?.marketId).toBe('market-shanghai');
    expect(runtime.queryMarkets({ cityKey: 'losangeles' }).rows[0]?.marketId).toBe('market-la');
    expect(runtime.queryMarkets({ cityKey: 'los-angeles' }).rows[0]?.marketId).toBe('market-la');
    expect(runtime.queryMarkets({ cityKey: 'CAN' }).rows[0]?.marketId).toBe('market-guangzhou');
    expect(runtime.queryMarkets({ cityKey: '广州' }).rows[0]?.marketId).toBe('market-guangzhou');
  });

  it('keeps current and future active markets above stale or resolved markets by default', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T12:00:00.000Z'));

    const runtime = createRuntime();
    seedRuntime(
      runtime,
      [
        buildMarket({
          marketId: 'market-resolved-past',
          eventDate: '2026-04-20',
          active: false,
          closed: true,
          updatedAt: Date.UTC(2026, 3, 25, 11),
        }),
        buildMarket({
          marketId: 'market-active-future',
          eventDate: '2026-04-26',
          active: true,
          closed: false,
          updatedAt: Date.UTC(2026, 3, 24, 8),
        }),
      ],
      [buildCity()],
    );

    const result = runtime.queryMarkets({ sortBy: 'updatedAt', sortDir: 'desc' });

    expect(result.rows.map((row: { marketId: string }) => row.marketId)).toEqual([
      'market-active-future',
    ]);
    expect(result.total).toBe(1);
  });

  it('treats ultra-low asks as a lottery queue with lower-price-sensitive lift thresholds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T10:00:30.000Z'));

    const runtime = createRuntime();
    seedRuntime(
      runtime,
      [
        buildMarket(),
        buildMarket({
          marketId: 'market-sf',
          eventId: 'event-sf',
          cityKey: 'san-francisco',
          seriesSlug: 'san-francisco-daily-weather',
          tokenYesId: 'yes-sf',
          tokenNoId: 'no-sf',
          groupItemTitle: '65F to 66F',
        }),
        buildMarket({
          marketId: 'market-ny',
          eventId: 'event-ny',
          cityKey: 'new-york',
          seriesSlug: 'new-york-daily-weather',
          tokenYesId: 'yes-ny',
          tokenNoId: 'no-ny',
          groupItemTitle: '68F to 69F',
        }),
      ],
      [
        buildCity(),
        buildCity({
          cityKey: 'san-francisco',
          displayName: 'San Francisco',
          seriesSlug: 'san-francisco-daily-weather',
          airportCode: 'KSFO',
          timezone: 'America/Los_Angeles',
        }),
        buildCity({
          cityKey: 'new-york',
          displayName: 'New York',
          seriesSlug: 'new-york-daily-weather',
          airportCode: 'KJFK',
          timezone: 'America/New_York',
        }),
      ],
    );

    const tickStart = Date.parse('2026-04-26T10:00:00.000Z');
    runtime.marketState.setHistoryWindow(60_000);

    runtime.marketState.recordTick({
      tokenId: 'yes-la',
      timestamp: tickStart,
      bestAsk: 0.02,
    });
    runtime.marketState.recordTick({
      tokenId: 'yes-la',
      timestamp: tickStart + 30_000,
      bestAsk: 0.05,
      spread: 0.01,
      askVisibleSize: 150,
      lastMessageAt: tickStart + 30_000,
    });

    runtime.marketState.recordTick({
      tokenId: 'yes-sf',
      timestamp: tickStart,
      bestAsk: 0.04,
    });
    runtime.marketState.recordTick({
      tokenId: 'yes-sf',
      timestamp: tickStart + 30_000,
      bestAsk: 0.08,
      spread: 0.01,
      askVisibleSize: 180,
      lastMessageAt: tickStart + 30_000,
    });

    runtime.marketState.recordTick({
      tokenId: 'yes-ny',
      timestamp: tickStart,
      bestAsk: 0.04,
    });
    runtime.marketState.recordTick({
      tokenId: 'yes-ny',
      timestamp: tickStart + 30_000,
      bestAsk: 0.07,
      spread: 0.01,
      askVisibleSize: 220,
      lastMessageAt: tickStart + 30_000,
    });

    const result = runtime.queryMarkets({
      lotteryOnly: true,
      sortBy: 'lotteryLift',
      sortDir: 'desc',
    });

    expect(result.rows.map((row: { marketId: string }) => row.marketId)).toEqual([
      'market-sf',
      'market-la',
    ]);
    expect(result.rows.map((row: { lotteryLift?: number | null }) => row.lotteryLift)).toEqual([
      0.04,
      0.03,
    ]);
    expect(result.rows.every((row: { lotteryCandidate?: boolean }) => row.lotteryCandidate === true)).toBe(true);
    expect(result.total).toBe(2);
    expect(runtime.queryMarkets({ cityKey: 'new-york', lotteryOnly: true }).rows).toHaveLength(0);
  });

  it('reuses the in-memory unacked alert index for dashboard snapshots and acknowledgements', () => {
    const runtime = createRuntime();
    seedRuntime(runtime, [buildMarket()], [buildCity()]);

    runtime.bubbleSnapshotByMarketId = new Map([
      [
        'market-la',
        {
          score: 72,
          severity: 'warning',
        },
      ],
    ]);
    runtime.uiRules = [
      {
        id: 'rule-1',
        name: 'Spread guard',
        isBuiltin: false,
        metric: 'spread',
        operator: '>',
        threshold: 0.05,
        windowSec: 60,
        cooldownSec: 60,
        dedupeWindowSec: 30,
        bubbleWeight: 60,
        severity: 'warning',
        enabled: true,
        soundProfileId: '',
        scope: {},
      },
    ];
    runtime.repository.insertAlertEvents = vi.fn(() => undefined);
    runtime.repository.acknowledgeAlertEvent = vi.fn(() => undefined);
    runtime.repository.queryAlertEvents = vi.fn(() => {
      throw new Error('dashboard should use cached unacked alerts');
    });
    queryRecentAlertEventsForScoringMock.mockImplementation(() => {
      throw new Error('new alerts should update bubble scores incrementally');
    });

    runtime.persistAndEmitAlerts([
      {
        id: 'alert-1',
        ruleId: 'rule-1',
        triggeredAt: Date.parse('2026-04-26T10:00:00.000Z'),
        cityKey: 'los-angeles',
        eventId: 'event-la',
        marketId: 'market-la',
        tokenId: 'yes-la',
        message: 'Spread widened quickly',
        severity: 'medium',
        dedupeKey: 'dedupe-1',
      },
    ]);

    const activeSnapshot = runtime.queryDashboard({
      eventDate: '2026-04-26',
      scope: 'alerts',
    });

    expect(runtime.repository.queryAlertEvents).not.toHaveBeenCalled();
    expect(queryRecentAlertEventsForScoringMock).not.toHaveBeenCalled();
    expect(activeSnapshot.rows).toHaveLength(1);
    expect(activeSnapshot.rows[0]?.unackedAlertCount).toBe(1);
    expect(activeSnapshot.rows[0]?.dominantRuleName).toBe('Spread guard');

    runtime.ackAlerts({ id: 'alert-1' });

    const ackedSnapshot = runtime.queryDashboard({
      eventDate: '2026-04-26',
      scope: 'risk',
    });

    expect(runtime.repository.queryAlertEvents).not.toHaveBeenCalled();
    expect(runtime.repository.acknowledgeAlertEvent).toHaveBeenCalledWith('alert-1');
    expect(ackedSnapshot.rows[0]?.unackedAlertCount).toBe(0);
    expect(ackedSnapshot.rows[0]?.dominantRuleName).toBeNull();
  });

  it('ages critical bubble scores from cached alerts without rescanning alert history each minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-26T10:00:00.000Z'));

    const runtime = createRuntime();
    seedRuntime(runtime, [buildMarket()], [buildCity()]);
    runtime.uiRules = [
      {
        id: 'rule-1',
        name: 'Spread guard',
        isBuiltin: false,
        metric: 'spread',
        operator: '>',
        threshold: 0.05,
        windowSec: 60,
        cooldownSec: 60,
        dedupeWindowSec: 30,
        bubbleWeight: 60,
        severity: 'warning',
        enabled: true,
        soundProfileId: '',
        scope: {},
      },
    ];

    queryRecentAlertEventsForScoringMock.mockReturnValue([
      {
        id: 'alert-history',
        ruleId: 'rule-1',
        builtinKey: null,
        triggeredAt: Date.parse('2026-04-26T10:00:00.000Z'),
        marketId: 'market-la',
      },
    ]);

    runtime.refreshBubbleAlertIndex();
    runtime.recomputeBubbleScores();

    expect(runtime.bubbleSnapshotByMarketId.get('market-la')).toEqual({
      score: 60,
      severity: 'critical',
    });
    expect(queryRecentAlertEventsForScoringMock).toHaveBeenCalledTimes(1);

    queryRecentAlertEventsForScoringMock.mockReset();
    queryRecentAlertEventsForScoringMock.mockImplementation(() => {
      throw new Error('bubble aging should not rescan alert history');
    });

    runtime.startBubbleScoreLoop();
    await vi.advanceTimersByTimeAsync(61 * 60 * 1000);

    expect(queryRecentAlertEventsForScoringMock).not.toHaveBeenCalled();
    expect(runtime.bubbleSnapshotByMarketId.get('market-la')).toEqual({
      score: 27,
      severity: 'warning',
    });
  });
});
