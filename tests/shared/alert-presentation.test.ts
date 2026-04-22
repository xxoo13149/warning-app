import { describe, expect, it } from 'vitest';

import {
  buildAlertNotificationContent,
  type AlertPresentationSource,
} from '../../src/shared/alert-presentation';

const buildAlert = (
  overrides: Partial<AlertPresentationSource> = {},
): AlertPresentationSource => ({
  ruleId: 'liquidity-kill',
  builtinKey: 'liquidity_kill',
  cityKey: 'los-angeles',
  marketId: 'market-1',
  messageKey: 'liquidity_kill',
  messageParams: {
    side: 'buy',
    previous: 0.2,
    actual: 0,
  },
  marketSnapshot: {
    cityName: 'Los Angeles',
    temperatureBand: '70°F to 71°F',
    yesPrice: 0.41,
    bestBid: 0.2,
    bestAsk: 0.22,
    spread: 0.02,
  },
  ...overrides,
});

describe('alert notification content', () => {
  it('builds a compact city + temperature + key value notification', () => {
    const notification = buildAlertNotificationContent(buildAlert());

    expect(notification.title).toBe('洛杉矶 · 70 至 71 华氏度');
    expect(notification.body).toBe('流动性骤降 · 买盘 20 美分 → 0 美分');
  });

  it('keeps threshold details compact for spread alerts', () => {
    const notification = buildAlertNotificationContent(
      buildAlert({
        ruleId: 'spread-threshold',
        builtinKey: 'spread_threshold',
        messageKey: 'spread_threshold',
        messageParams: {
          actual: 0.03,
          threshold: 0.02,
        },
      }),
    );

    expect(notification.body).toBe('价差过宽 · 价差 3 美分 · 阈值 2 美分');
  });

  it('falls back to a short system notification title', () => {
    const notification = buildAlertNotificationContent(
      buildAlert({
        ruleId: 'worker-error',
        builtinKey: undefined,
        cityKey: '',
        marketId: '',
        messageKey: 'system_error',
        messageParams: {
          reason: 'worker crashed',
        },
        marketSnapshot: undefined,
      }),
    );

    expect(notification.title).toBe('系统告警');
    expect(notification.body).toBe('系统异常 · 监控链路异常');
  });
});
