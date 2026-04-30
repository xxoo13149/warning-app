import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MessageChannel } from 'node:worker_threads';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/db/repository', () => {
  class WeatherMonitorRepository {
    upsertAlertRules(): void {
      return undefined;
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
  }

  return { PolymarketDataService };
});

import type { AlertRule } from '../../src/shared/monitor-contracts';
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

const createUiRule = (
  overrides: Partial<AlertRule> & Pick<AlertRule, 'metric'>,
): AlertRule => ({
  id: overrides.id ?? `rule-${overrides.metric}`,
  name: overrides.name ?? overrides.metric,
  isBuiltin: overrides.isBuiltin ?? false,
  builtinKey: overrides.builtinKey,
  metric: overrides.metric,
  operator:
    overrides.operator ??
    (overrides.metric === 'liquidity_kill' ? '>=' : overrides.metric === 'feed_stale' ? '>' : '>'),
  threshold: overrides.threshold ?? (overrides.metric === 'feed_stale' ? 90 : 5),
  windowSec: overrides.windowSec ?? 300,
  cooldownSec: overrides.cooldownSec ?? 120,
  dedupeWindowSec: overrides.dedupeWindowSec ?? 60,
  bubbleWeight: overrides.bubbleWeight ?? 60,
  severity: overrides.severity ?? 'warning',
  enabled: overrides.enabled ?? true,
  soundProfileId: overrides.soundProfileId ?? '',
  scope: overrides.scope ?? {},
  quietHours: overrides.quietHours,
});

afterEach(() => {
  for (const runtime of createdRuntimes.splice(0)) {
    clearTimeout(runtime.pendingMarketTickTimer);
    clearTimeout(runtime.pendingDashboardTickTimer);
    clearTimeout(runtime.priceTickFlushTimer);
    clearTimeout(runtime.serviceRetryTimer);
    clearTimeout(runtime.startupMaintenanceTimer);
    clearInterval(runtime.bubbleScoreTimer);
    clearInterval(runtime.maintenanceTimer);
    runtime.port?.close?.();
  }
});

describe('worker runtime market history window', () => {
  it('shrinks in-memory tick history when saved rules stop needing a long window', () => {
    const runtime = createRuntime();
    vi.spyOn(runtime, 'runCurrentRuleCheck').mockImplementation(() => undefined);

    runtime.saveRules([
      createUiRule({
        metric: 'change5m',
        windowSec: 300,
      }),
    ]);

    const t0 = Date.UTC(2026, 3, 28, 10, 0, 0);
    runtime.marketState.recordTick({
      tokenId: 'token-1',
      marketId: 'market-1',
      timestamp: t0,
      lastTradePrice: 0.51,
    });
    runtime.marketState.recordTick({
      tokenId: 'token-1',
      marketId: 'market-1',
      timestamp: t0 + 120_000,
      lastTradePrice: 0.52,
    });
    runtime.marketState.recordTick({
      tokenId: 'token-1',
      marketId: 'market-1',
      timestamp: t0 + 240_000,
      lastTradePrice: 0.53,
    });

    expect(
      runtime.marketState
        .getHistory('token-1', 24 * 60 * 60_000, t0 + 240_000)
        .map((item: { timestamp: number }) => item.timestamp),
    ).toEqual([t0, t0 + 120_000, t0 + 240_000]);

    runtime.saveRules([
      createUiRule({
        id: 'feed-stale',
        metric: 'feed_stale',
        windowSec: 90,
      }),
    ]);

    expect(
      runtime.marketState
        .getHistory('token-1', 24 * 60 * 60_000, t0 + 240_000)
        .map((item: { timestamp: number }) => item.timestamp),
    ).toEqual([t0 + 240_000]);
  });

  it('uses the largest enabled history-based rule window when saving rules', () => {
    const runtime = createRuntime();
    vi.spyOn(runtime, 'runCurrentRuleCheck').mockImplementation(() => undefined);

    runtime.saveRules([
      createUiRule({
        id: 'disabled-long-window',
        metric: 'change5m',
        windowSec: 300,
        enabled: false,
      }),
      createUiRule({
        id: 'active-short-window',
        metric: 'liquidity_kill',
        operator: '>=',
        threshold: 0.2,
        windowSec: 60,
        enabled: true,
      }),
    ]);

    const t0 = Date.UTC(2026, 3, 28, 11, 0, 0);
    runtime.marketState.recordTick({
      tokenId: 'token-1',
      marketId: 'market-1',
      timestamp: t0,
      bestBid: 0.3,
      bestAsk: 0.31,
    });
    runtime.marketState.recordTick({
      tokenId: 'token-1',
      marketId: 'market-1',
      timestamp: t0 + 90_000,
      bestBid: 0.28,
      bestAsk: 0.29,
    });

    expect(
      runtime.marketState
        .getHistory('token-1', 24 * 60 * 60_000, t0 + 90_000)
        .map((item: { timestamp: number }) => item.timestamp),
    ).toEqual([t0 + 90_000]);
  });
});
