import { describe, expect, it } from 'vitest';

import type { AlertEvent, AppHealth, CityBubbleSummary } from '../../src/renderer/types/contracts';
import {
  buildDashboardBubbleId,
  buildBubblePhysicsSignature,
  buildDashboardBubbleData,
  buildDashboardBubblePhysicsData,
  buildDashboardBubbleStats,
} from '../../src/renderer/utils/dashboard-bubble-adapter';

const buildSummary = (overrides: Partial<CityBubbleSummary> = {}): CityBubbleSummary => ({
  cityKey: 'buenos-aires',
  cityName: 'Buenos Aires',
  airportCode: 'SAEZ',
  eventDate: '2026-04-15',
  marketCount: 10,
  watchlisted: true,
  unackedAlertCount: 2,
  cityBubbleScore: 88,
  cityBubbleSeverity: 'critical',
  dominantMarketId: 'market-1',
  dominantTemperatureBand: '24°C to 25°C',
  dominantYesPrice: 0.47,
  dominantRuleName: '流动性斩杀',
  updatedAt: '2026-04-15T00:00:00.000Z',
  topMarkets: [
    {
      marketId: 'market-1',
      temperatureBand: '24°C to 25°C',
      yesPrice: 0.47,
      bestBid: 0.46,
      bestAsk: 0.48,
      spread: 0.02,
      change5m: 1.2,
      bubbleScore: 88,
      bubbleSeverity: 'critical',
      updatedAt: '2026-04-15T00:00:00.000Z',
    },
  ],
  ...overrides,
});

const buildAlert = (overrides: Partial<AlertEvent> = {}): AlertEvent => ({
  id: 'alert-1',
  ruleId: 'rule-1',
  triggeredAt: '2026-04-15T00:01:00.000Z',
  cityKey: 'buenos-aires',
  marketId: 'market-1',
  tokenId: 'token-1',
  message: '流动性斩杀',
  severity: 'critical',
  acknowledged: false,
  ...overrides,
});

const health: AppHealth = {
  connected: true,
  mode: 'live',
  shardActive: 3,
  shardTotal: 3,
  subscribedTokens: 100,
  reconnects: 0,
  latencyMs: 24,
  droppedEvents: 0,
  lastSyncAt: '2026-04-15T00:00:00.000Z',
};

describe('dashboard bubble adapter', () => {
  it('maps dashboard summaries into zip visual bubble data', () => {
    const rows = buildDashboardBubbleData(
      [buildSummary()],
      [buildAlert()],
      Date.parse('2026-04-15T00:02:00.000Z'),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe('SAEZ');
    expect(rows[0]?.region).toBe('OTHER');
    expect(rows[0]?.riskLevel).toBe(88);
    expect(rows[0]?.status_level).toBe('CRITICAL');
    expect(rows[0]?.is_new_alert).toBe(true);
    expect(rows[0]?.temperature).toBe(25);
    expect(rows[0]?.trend).toBe('up');
  });

  it('falls back to initials when airport code is missing', () => {
    const rows = buildDashboardBubbleData(
      [
        buildSummary({
          cityKey: 'san-francisco',
          cityName: 'San Francisco',
          airportCode: null,
        }),
      ],
      [],
      Date.parse('2026-04-15T00:10:00.000Z'),
    );

    expect(rows[0]?.code).toBe('SF');
    expect(rows[0]?.is_new_alert).toBe(false);
  });

  it('builds distinct bubble ids for the same city across different dates', () => {
    const rows = [
      buildSummary({
        cityKey: 'london',
        cityName: 'London',
        airportCode: 'EGLC',
        eventDate: '2026-04-15',
      }),
      buildSummary({
        cityKey: 'london',
        cityName: 'London',
        airportCode: 'EGLC',
        eventDate: '2026-04-16',
      }),
    ];

    const visualRows = buildDashboardBubbleData(rows, [], Date.parse('2026-04-16T00:10:00.000Z'));
    const physicsRows = buildDashboardBubblePhysicsData(rows);

    expect(visualRows.map((row) => row.id)).toEqual([
      buildDashboardBubbleId('london', '2026-04-15'),
      buildDashboardBubbleId('london', '2026-04-16'),
    ]);
    expect(physicsRows.map((row) => row.id)).toEqual(visualRows.map((row) => row.id));
    expect(new Set(visualRows.map((row) => row.id)).size).toBe(2);
  });

  it('keeps the physics signature stable for score and radius churn', () => {
    const basePhysics = buildDashboardBubblePhysicsData([buildSummary()]);
    const smallChangePhysics = buildDashboardBubblePhysicsData([
      buildSummary({
        cityBubbleScore: 90,
      }),
    ]);
    const largeChangePhysics = buildDashboardBubblePhysicsData([
      buildSummary({
        cityBubbleScore: 12,
        dominantTemperatureBand: '28°C or higher',
        dominantYesPrice: 0.8,
      }),
    ]);

    const baseSignature = buildBubblePhysicsSignature(basePhysics, {
      layoutKey: '2026-04-15',
      filterMode: 'ALL',
      regionFilter: 'ALL',
    });
    const smallChangeSignature = buildBubblePhysicsSignature(smallChangePhysics, {
      layoutKey: '2026-04-15',
      filterMode: 'ALL',
      regionFilter: 'ALL',
    });
    const largeChangeSignature = buildBubblePhysicsSignature(largeChangePhysics, {
      layoutKey: '2026-04-15',
      filterMode: 'ALL',
      regionFilter: 'ALL',
    });

    expect(smallChangePhysics[0]?.visualRadius).not.toBe(basePhysics[0]?.visualRadius);
    expect(basePhysics[0]?.visualRadius).toBeLessThanOrEqual(54);
    expect(largeChangePhysics[0]?.visualRadius).toBeGreaterThanOrEqual(22);
    expect(baseSignature).toBe(smallChangeSignature);
    expect(baseSignature).toBe(largeChangeSignature);
  });

  it('keeps risk level and radius finite when upstream scores are invalid', () => {
    const invalidRows = [
      buildSummary({ cityKey: 'nan-score', cityBubbleScore: Number.NaN }),
      buildSummary({ cityKey: 'infinite-score', cityBubbleScore: Number.POSITIVE_INFINITY }),
      buildSummary({
        cityKey: 'missing-score',
        cityBubbleScore: undefined as unknown as number,
      }),
    ];

    const visualRows = buildDashboardBubbleData(invalidRows, []);
    const physicsRows = buildDashboardBubblePhysicsData(invalidRows);

    for (const row of visualRows) {
      expect(Number.isFinite(row.riskLevel)).toBe(true);
      expect(row.riskLevel).toBeGreaterThanOrEqual(0);
      expect(row.riskLevel).toBeLessThanOrEqual(100);
    }

    for (const row of physicsRows) {
      expect(Number.isFinite(row.visualRadius)).toBe(true);
      expect(row.visualRadius).toBeGreaterThanOrEqual(22);
      expect(row.visualRadius).toBeLessThanOrEqual(54);
    }
  });

  it('changes the physics signature when collision padding changes', () => {
    const physics = buildDashboardBubblePhysicsData([buildSummary()]);
    const baseSignature = buildBubblePhysicsSignature(physics, {
      layoutKey: '2026-04-15',
      filterMode: 'ALL',
      regionFilter: 'ALL',
      bubblePadding: 0,
    });
    const paddedSignature = buildBubblePhysicsSignature(physics, {
      layoutKey: '2026-04-15',
      filterMode: 'ALL',
      regionFilter: 'ALL',
      bubblePadding: 24,
    });

    expect(paddedSignature).not.toBe(baseSignature);
  });

  it('changes the physics signature when layout or visible set changes', () => {
    const basePhysics = buildDashboardBubblePhysicsData([buildSummary()]);
    const expandedPhysics = buildDashboardBubblePhysicsData([
      buildSummary(),
      buildSummary({
        cityKey: 'london',
        cityName: 'London',
        airportCode: 'EGLC',
      }),
    ]);

    const baseSignature = buildBubblePhysicsSignature(basePhysics, {
      layoutKey: '2026-04-15',
      filterMode: 'ALL',
      regionFilter: 'ALL',
    });

    expect(
      buildBubblePhysicsSignature(basePhysics, {
        layoutKey: '2026-04-16',
        filterMode: 'ALL',
        regionFilter: 'ALL',
      }),
    ).not.toBe(baseSignature);

    expect(
      buildBubblePhysicsSignature(expandedPhysics, {
        layoutKey: '2026-04-15',
        filterMode: 'ALL',
        regionFilter: 'ALL',
      }),
    ).not.toBe(baseSignature);

    expect(
      buildBubblePhysicsSignature(basePhysics, {
        layoutKey: '2026-04-15',
        filterMode: 'ALERTS',
        regionFilter: 'ALL',
      }),
    ).not.toBe(baseSignature);
  });

  it('builds bottom stats from adapted bubble data', () => {
    const cities = buildDashboardBubbleData(
      [
        buildSummary(),
        buildSummary({
          cityKey: 'london',
          cityName: 'London',
          airportCode: 'EGLC',
          cityBubbleScore: 42,
          cityBubbleSeverity: 'warning',
          unackedAlertCount: 1,
        }),
      ],
      [buildAlert()],
      Date.parse('2026-04-15T00:02:00.000Z'),
    );

    const stats = buildDashboardBubbleStats(cities, health, 20, '2026-04-15');

    expect(stats.totalAlerts).toBe(3);
    expect(stats.highRiskCount).toBe(1);
    expect(stats.visibleCityCount).toBe(2);
    expect(stats.coveredMarketCount).toBe(20);
    expect(stats.monitorStatusText).toBe('监控运行中');
  });
});
