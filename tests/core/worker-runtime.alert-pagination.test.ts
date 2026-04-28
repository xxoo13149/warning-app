import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { MessageChannel } from 'node:worker_threads';

import { afterEach, describe, expect, it, vi } from 'vitest';

const { queryAlertEventsMock } = vi.hoisted(() => ({
  queryAlertEventsMock: vi.fn(),
}));

vi.mock('../../src/core/db/repository', () => {
  class WeatherMonitorRepository {
    queryAlertEvents = queryAlertEventsMock;
  }

  return {
    ALERT_EVENT_PAGE_LIMIT_DEFAULT: 200,
    ALERT_EVENT_PAGE_LIMIT_MAX: 500,
    WeatherMonitorRepository,
  };
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

const createRuntime = () => {
  const { port1, port2 } = new MessageChannel();
  const runtime = new WorkerRuntime(port1, {
    dbPath: path.join(tmpdir(), `warning-app-alerts-${randomUUID()}.sqlite`),
  }) as any;
  port2.close();
  createdRuntimes.push(runtime);
  return runtime;
};

afterEach(() => {
  queryAlertEventsMock.mockReset();
  for (const runtime of createdRuntimes.splice(0)) {
    runtime.port?.close?.();
  }
});

describe('WorkerRuntime alert pagination', () => {
  it('parses ISO cursors, forwards the repository query shape, and restores JSON fields', () => {
    const runtime = createRuntime();
    runtime.uiRules = [
      {
        id: 'rule-1',
        soundProfileId: 'sound-soft',
      },
    ];

    const cursorIso = '2026-04-24T01:00:00.000Z';
    const nextCursorAt = Date.parse('2026-04-24T00:59:00.000Z');
    const messageParams = {
      threshold: 0.42,
      currentValue: 0.57,
    };
    const marketSnapshot = {
      cityName: 'Tokyo',
      airportCode: 'RJTT',
      eventDate: '2026-04-24',
      temperatureBand: '18C to 20C',
      yesPrice: 0.57,
      bestBid: 0.56,
      bestAsk: 0.58,
      spread: 0.02,
      change5m: 3.1,
    };

    queryAlertEventsMock.mockReturnValue({
      rows: [
        {
          id: 'alert-1',
          ruleId: 'rule-1',
          builtinKey: null,
          triggeredAt: Date.parse('2026-04-24T01:05:00.000Z'),
          cityKey: 'tokyo',
          marketId: 'market-1',
          tokenId: 'token-1',
          message: 'Spread widened quickly',
          messageKey: null,
          messageParams: JSON.stringify(messageParams),
          marketSnapshot: JSON.stringify(marketSnapshot),
          severity: 'medium',
          acknowledged: false,
        },
      ],
      total: 7,
      hasMore: true,
      nextCursor: {
        triggeredAt: nextCursorAt,
        id: 'alert-older',
      },
    });

    const result = runtime.listAlerts({
      limit: 50,
      acknowledged: false,
      cursor: {
        triggeredAt: cursorIso,
        id: 'alert-cursor',
      },
    }) as {
      rows: Array<{
        message: string;
        messageParams?: typeof messageParams;
        marketSnapshot?: typeof marketSnapshot;
        soundProfileId?: string;
      }>;
      total: number;
      hasMore: boolean;
      nextCursor?: { triggeredAt: string; id: string };
    };

    expect(queryAlertEventsMock).toHaveBeenCalledWith({
      limit: 50,
      acknowledged: false,
      cursor: {
        triggeredAt: Date.parse(cursorIso),
        id: 'alert-cursor',
      },
    });
    expect(result.total).toBe(7);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toEqual({
      triggeredAt: new Date(nextCursorAt).toISOString(),
      id: 'alert-older',
    });
    expect(result.rows[0]?.message).toBe('Spread widened quickly');
    expect(result.rows[0]?.messageParams).toEqual(messageParams);
    expect(result.rows[0]?.marketSnapshot).toEqual(marketSnapshot);
    expect(result.rows[0]?.soundProfileId).toBe('sound-soft');
  });

  it('drops invalid cursors instead of forwarding malformed timestamps to the repository', () => {
    const runtime = createRuntime();
    queryAlertEventsMock.mockReturnValue({
      rows: [],
      total: 0,
      hasMore: false,
      nextCursor: undefined,
    });

    runtime.listAlerts({
      limit: 20,
      cursor: {
        triggeredAt: 'not-an-iso-date',
        id: 'cursor-id',
      },
    });

    expect(queryAlertEventsMock).toHaveBeenCalledWith({
      limit: 20,
      acknowledged: undefined,
      cursor: undefined,
    });
  });

  it('walks repository pages for internal alert aggregations instead of only reading the first page', () => {
    const runtime = createRuntime();
    const firstCursor = {
      triggeredAt: Date.parse('2026-04-24T01:00:00.000Z'),
      id: 'alert-newer',
    };

    queryAlertEventsMock
      .mockReturnValueOnce({
        rows: [
          {
            id: 'alert-newer',
            triggeredAt: firstCursor.triggeredAt,
          },
        ],
        total: 2,
        hasMore: true,
        nextCursor: firstCursor,
      })
      .mockReturnValueOnce({
        rows: [
          {
            id: 'alert-older',
            triggeredAt: Date.parse('2026-04-24T00:59:00.000Z'),
          },
        ],
        total: 2,
        hasMore: false,
        nextCursor: {
          triggeredAt: Date.parse('2026-04-24T00:59:00.000Z'),
          id: 'alert-older',
        },
      });

    const rows = runtime.queryAllAlertEventRows({ acknowledged: false }) as Array<{
      id: string;
    }>;

    expect(rows.map((row) => row.id)).toEqual(['alert-newer', 'alert-older']);
    expect(queryAlertEventsMock).toHaveBeenNthCalledWith(1, {
      acknowledged: false,
      limit: 500,
      cursor: undefined,
    });
    expect(queryAlertEventsMock).toHaveBeenNthCalledWith(2, {
      acknowledged: false,
      limit: 500,
      cursor: firstCursor,
    });
  });
});
