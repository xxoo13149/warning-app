import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MessageChannel } from 'node:worker_threads';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/core/db/repository', () => {
  type StoredRule = Record<string, unknown>;

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

    private alertRules: StoredRule[] = [];

    queryRecentAlertEventsForScoring = vi.fn(() => []);
    querySoundProfiles = vi.fn(() => []);

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

    queryAlertRules(): StoredRule[] {
      return this.alertRules.map((rule) => structuredClone(rule));
    }

    upsertAlertRules(rules: StoredRule[]): void {
      this.alertRules = rules.map((rule) => structuredClone(rule));
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
import {
  ABNORMAL_LOTTERY_DEFAULT_MIN_LIFT,
  ABNORMAL_LOTTERY_DEFAULT_WINDOW_MS,
} from '../../src/core/alerts/abnormal-lottery';
import { WorkerRuntime } from '../../src/core/worker-runtime';

type RuntimeUnderTest = {
  port?: { close?: () => void };
  pendingMarketTickTimer?: ReturnType<typeof setTimeout>;
  pendingDashboardTickTimer?: ReturnType<typeof setTimeout>;
  priceTickFlushTimer?: ReturnType<typeof setTimeout>;
  serviceRetryTimer?: ReturnType<typeof setTimeout>;
  startupMaintenanceTimer?: ReturnType<typeof setTimeout>;
  bubbleScoreTimer?: ReturnType<typeof setInterval>;
  maintenanceTimer?: ReturnType<typeof setInterval>;
  trackedMarketById: Map<string, ReturnType<typeof buildMarket>>;
  cityByKey: Map<string, ReturnType<typeof buildCity>>;
  latestTokenStateById: Map<string, unknown>;
  uiRules: Array<Record<string, unknown>>;
  engineRules: Array<Record<string, unknown>>;
  repository: {
    queryAlertRules: () => Array<Record<string, unknown>>;
    upsertAlertRules: (rules: Array<Record<string, unknown>>) => void;
  };
  runCurrentRuleCheck: () => void;
  saveRules: (rules: AlertRule[]) => { rows: AlertRule[] };
  refreshRulesSync: () => void;
  previewRule: (rule: AlertRule) => { matchedCityCount: number; matchedMarketCount: number };
};

const createdRuntimes: RuntimeUnderTest[] = [];

const createRuntime = () => {
  const { port1, port2 } = new MessageChannel();
  const runtime = new WorkerRuntime(port1, {
    dbPath: path.join(tmpdir(), `weather-monitor-${randomUUID()}.sqlite`),
  }) as unknown as RuntimeUnderTest;
  port2.close();
  createdRuntimes.push(runtime);
  return runtime;
};

const buildRule = (overrides: Partial<AlertRule> = {}): AlertRule => ({
  id: overrides.id ?? 'rule-1',
  name: overrides.name ?? 'Spread guard',
  isBuiltin: overrides.isBuiltin ?? false,
  builtinKey: overrides.builtinKey,
  metric: overrides.metric ?? 'spread',
  operator: overrides.operator ?? '>',
  threshold: overrides.threshold ?? 0.05,
  windowSec: overrides.windowSec ?? 60,
  cooldownSec: overrides.cooldownSec ?? 120,
  dedupeWindowSec: overrides.dedupeWindowSec ?? 60,
  bubbleWeight: overrides.bubbleWeight ?? 60,
  severity: overrides.severity ?? 'warning',
  enabled: overrides.enabled ?? true,
  soundProfileId: overrides.soundProfileId ?? '',
  liquiditySide: overrides.liquiditySide,
  scope: overrides.scope ?? {},
  quietHours: overrides.quietHours,
});

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

const seedRuntime = (runtime: RuntimeUnderTest) => {
  const market = buildMarket();
  const city = buildCity();
  runtime.trackedMarketById = new Map([[market.marketId, market]]);
  runtime.cityByKey = new Map([[city.cityKey, city]]);
  runtime.latestTokenStateById = new Map();
};

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

describe('worker runtime rule scope normalization', () => {
  it('drops scope when saving rules', () => {
    const runtime = createRuntime();
    seedRuntime(runtime);
    vi.spyOn(runtime, 'runCurrentRuleCheck').mockImplementation(() => undefined);

    const result = runtime.saveRules([
      buildRule({
        scope: {
          cityKey: 'los-angeles',
          eventDate: '2030-04-26',
          marketId: 'market-la',
          side: 'YES',
        },
      }),
    ]);

    expect(result.rows[0]?.scope).toEqual({});
    expect(runtime.uiRules[0]?.scope).toEqual({});
    expect(runtime.engineRules[0]?.scope).toEqual({});
    expect(runtime.repository.queryAlertRules()[0]?.scope).toEqual({});
  });

  it('rewrites legacy stored scopes to global rules on refresh', () => {
    const runtime = createRuntime();

    runtime.repository.upsertAlertRules([
      {
        id: 'legacy-spread-rule',
        name: 'Legacy spread rule',
        isBuiltin: false,
        builtinKey: undefined,
        enabled: true,
        metric: 'spread',
        operator: '>',
        threshold: 0.05,
        windowSec: 60,
        cooldownSec: 120,
        dedupeWindowSec: 60,
        bubbleWeight: 60,
        severity: 'medium',
        soundProfileId: undefined,
        liquiditySide: undefined,
        scope: {
          cityKey: 'los-angeles',
          marketId: 'market-la',
          eventDate: '2030-04-26',
          side: 'yes',
        },
      },
    ]);

    runtime.refreshRulesSync();

    expect(runtime.uiRules[0]?.scope).toEqual({});
    expect(runtime.engineRules[0]?.scope).toEqual({});
    expect(runtime.repository.queryAlertRules()[0]?.scope).toEqual({});
  });

  it('ignores incoming scope during preview', () => {
    const runtime = createRuntime();
    seedRuntime(runtime);

    const result = runtime.previewRule(
      buildRule({
        metric: 'change5m',
        scope: {
          cityKey: 'new-york',
          eventDate: '2030-05-01',
          marketId: 'missing-market',
        },
      }),
    );

    expect(result.matchedCityCount).toBe(1);
    expect(result.matchedMarketCount).toBe(1);
  });

  it('self-heals malformed builtin abnormal lottery rules during refresh', () => {
    const runtime = createRuntime();

    runtime.repository.upsertAlertRules([
      {
        id: 'abnormal-lottery',
        name: 'Broken abnormal lottery',
        isBuiltin: true,
        builtinKey: 'abnormal_lottery',
        enabled: true,
        metric: 'spread_threshold',
        operator: '>',
        threshold: 0.08,
        windowSec: 30,
        cooldownSec: 45,
        dedupeWindowSec: 15,
        bubbleWeight: 10,
        severity: 'warning',
        soundProfileId: undefined,
        liquiditySide: 'buy',
        scope: {},
      },
    ]);

    runtime.refreshRulesSync();

    expect(runtime.uiRules[0]?.metric).toBe('abnormal_lottery');
    expect(runtime.engineRules[0]?.metric).toBe('abnormal_lottery');
    expect(runtime.repository.queryAlertRules()[0]?.metric).toBe('abnormal_lottery');
    expect(runtime.uiRules[0]?.threshold).toBe(ABNORMAL_LOTTERY_DEFAULT_MIN_LIFT);
    expect(runtime.uiRules[0]?.windowSec).toBe(ABNORMAL_LOTTERY_DEFAULT_WINDOW_MS / 1000);
    expect(runtime.uiRules[0]?.operator).toBe('>=');
  });

  it('self-heals legacy builtin liquidity kill defaults to the ladder threshold', () => {
    const runtime = createRuntime();

    runtime.repository.upsertAlertRules([
      {
        id: 'liquidity-kill',
        name: 'Legacy liquidity kill',
        isBuiltin: true,
        builtinKey: 'liquidity_kill',
        enabled: true,
        metric: 'liquidity_kill',
        operator: '<=',
        threshold: 0.01,
        windowSec: 60,
        cooldownSec: 180,
        dedupeWindowSec: 90,
        bubbleWeight: 90,
        severity: 'critical',
        soundProfileId: undefined,
        liquiditySide: undefined,
        scope: {},
      },
    ]);

    runtime.refreshRulesSync();

    expect(runtime.uiRules[0]?.metric).toBe('liquidity_kill');
    expect(runtime.uiRules[0]?.operator).toBe('>=');
    expect(runtime.uiRules[0]?.threshold).toBe(0.08);
    expect(runtime.uiRules[0]?.windowSec).toBe(60);
    expect(runtime.uiRules[0]?.cooldownSec).toBe(120);
    expect(runtime.uiRules[0]?.dedupeWindowSec).toBe(60);
    expect(runtime.uiRules[0]?.liquiditySide).toBe('both');
  });
});
