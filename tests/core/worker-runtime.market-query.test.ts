import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MessageChannel } from 'node:worker_threads';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/db/repository', () => {
  class WeatherMonitorRepository {}

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
  eventDate: '2026-04-26',
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
  for (const runtime of createdRuntimes.splice(0)) {
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
});
