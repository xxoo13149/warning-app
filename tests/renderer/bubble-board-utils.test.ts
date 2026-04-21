import { describe, expect, it } from 'vitest';

import type { AlertEvent, CityBubbleSummary } from '../../src/renderer/types/contracts';
import {
  BUBBLE_FLASH_WINDOW_MS,
  BUBBLE_MAX_RADIUS,
  BUBBLE_MIN_RADIUS,
  buildBubbleRadius,
  buildCityBubbleVisualRows,
  buildTooltipSnapshot,
  computeBurstImpulse,
  computeFlashWindow,
  deriveBubbleHue,
  generateBubblePoints,
  pickVisibleBubbleLabels,
} from '../../src/renderer/utils/bubble-board';

const buildSummary = (overrides: Partial<CityBubbleSummary> = {}): CityBubbleSummary => ({
  cityKey: 'buenos-aires',
  cityName: 'Buenos Aires',
  eventDate: '2026-04-14',
  marketCount: 12,
  watchlisted: true,
  unackedAlertCount: 2,
  cityBubbleScore: 78,
  cityBubbleSeverity: 'warning',
  dominantMarketId: 'market-1',
  dominantTemperatureBand: '25°C',
  dominantYesPrice: 0.47,
  dominantRuleName: '流动性斩杀',
  updatedAt: '2026-04-14T00:00:00.000Z',
  topMarkets: [
    {
      marketId: 'market-1',
      temperatureBand: '25°C',
      yesPrice: 0.47,
      bestBid: 0.46,
      bestAsk: 0.48,
      spread: 0.02,
      change5m: 0.11,
      bubbleScore: 78,
      bubbleSeverity: 'warning',
      updatedAt: '2026-04-14T00:00:00.000Z',
    },
  ],
  ...overrides,
});

const buildAlert = (overrides: Partial<AlertEvent> = {}): AlertEvent => ({
  id: 'alert-1',
  ruleId: 'rule-1',
  triggeredAt: '2026-04-14T00:01:00.000Z',
  cityKey: 'buenos-aires',
  marketId: 'market-1',
  tokenId: 'token-1',
  message: '流动性斩杀',
  severity: 'critical',
  acknowledged: false,
  ...overrides,
});

describe('bubble board utils', () => {
  it('maps bubble size upward with higher scores and respects bounds', () => {
    const low = buildBubbleRadius({ score: 0, width: 1280, height: 820, count: 47 });
    const high = buildBubbleRadius({ score: 100, width: 1280, height: 820, count: 47 });

    expect(low).toBeGreaterThanOrEqual(BUBBLE_MIN_RADIUS);
    expect(high).toBeLessThanOrEqual(BUBBLE_MAX_RADIUS);
    expect(high).toBeGreaterThan(low);
  });

  it('generates stable seeded points within bounds', () => {
    const first = generateBubblePoints({
      count: 10,
      width: 900,
      height: 640,
      padding: 40,
      seed: 1234,
    });
    const second = generateBubblePoints({
      count: 10,
      width: 900,
      height: 640,
      padding: 40,
      seed: 1234,
    });

    expect(first).toEqual(second);
    expect(first).toHaveLength(10);
    first.forEach((point) => {
      expect(point.x).toBeGreaterThanOrEqual(40);
      expect(point.x).toBeLessThanOrEqual(860);
      expect(point.y).toBeGreaterThanOrEqual(40);
      expect(point.y).toBeLessThanOrEqual(600);
    });
  });

  it('computes flash windows from the latest city alert only', () => {
    const nowMs = Date.parse('2026-04-14T00:02:00.000Z');
    const alerts = [
      buildAlert({ triggeredAt: '2026-04-14T00:00:30.000Z' }),
      buildAlert({ id: 'alert-2', triggeredAt: '2026-04-14T00:01:40.000Z' }),
      buildAlert({ id: 'alert-3', cityKey: 'sydney', triggeredAt: '2026-04-14T00:01:59.000Z' }),
    ];

    const flash = computeFlashWindow(alerts, 'buenos-aires', nowMs);
    const expired = computeFlashWindow(
      [buildAlert({ triggeredAt: '2026-04-13T23:55:00.000Z' })],
      'buenos-aires',
      nowMs,
    );

    expect(flash.flashActive).toBe(true);
    expect(flash.latestAlertAtMs).toBe(Date.parse('2026-04-14T00:01:40.000Z'));
    expect(flash.flashUntilMs).toBe(
      Date.parse('2026-04-14T00:01:40.000Z') + BUBBLE_FLASH_WINDOW_MS,
    );
    expect(expired.flashActive).toBe(false);
  });

  it('builds tooltip snapshots even when no top market exists', () => {
    const summary = buildSummary({
      topMarkets: [],
      dominantRuleName: null,
    });

    const snapshot = buildTooltipSnapshot(summary);

    expect(snapshot.cityName).toBe('Buenos Aires');
    expect(snapshot.bestBid).toBeNull();
    expect(snapshot.bestAsk).toBeNull();
    expect(snapshot.spread).toBeNull();
    expect(snapshot.dominantRuleName).toBeNull();
  });

  it('derives renderer rows with flash state, severity, and tooltip data', () => {
    const rows = buildCityBubbleVisualRows(
      [buildSummary()],
      [buildAlert()],
      Date.parse('2026-04-14T00:01:30.000Z'),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.flashActive).toBe(true);
    expect(rows[0]?.ringSeverity).toBe('warning');
    expect(rows[0]?.colorSeed).toBeGreaterThan(0);
    expect(rows[0]?.tooltipSnapshot.temperatureBand).toBe('25°C');
  });

  it('keeps selected and hovered labels visible beyond the default limit', () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
      cityKey: `city-${index}`,
    }));

    const labels = pickVisibleBubbleLabels(rows, 2, 'city-4', 'city-3');

    expect(labels.has('city-0')).toBe(true);
    expect(labels.has('city-1')).toBe(true);
    expect(labels.has('city-3')).toBe(true);
    expect(labels.has('city-4')).toBe(true);
  });

  it('computes burst impulses only for nodes inside the burst radius', () => {
    const inside = computeBurstImpulse({
      nodeX: 120,
      nodeY: 100,
      centerX: 100,
      centerY: 100,
      radius: 60,
      strength: 0.3,
    });
    const center = computeBurstImpulse({
      nodeX: 100,
      nodeY: 100,
      centerX: 100,
      centerY: 100,
      radius: 60,
      strength: 0.3,
    });
    const outside = computeBurstImpulse({
      nodeX: 200,
      nodeY: 200,
      centerX: 100,
      centerY: 100,
      radius: 60,
      strength: 0.3,
    });

    expect(inside.affected).toBe(true);
    expect(Math.hypot(inside.vx, inside.vy)).toBeGreaterThan(0);
    expect(Number.isFinite(center.vx)).toBe(true);
    expect(Number.isFinite(center.vy)).toBe(true);
    expect(outside).toEqual({ vx: 0, vy: 0, affected: false });
  });

  it('derives stable cool-tone hues from the city seed', () => {
    const first = deriveBubbleHue(12345);
    const second = deriveBubbleHue(12345);

    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(190);
    expect(first).toBeLessThanOrEqual(232);
  });
});
