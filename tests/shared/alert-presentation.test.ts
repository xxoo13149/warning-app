import { describe, expect, it } from 'vitest';

import {
  buildAlertPresentation,
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
    outcome: 'yes',
    side: 'buy',
    previous: 0.2,
    actual: 0,
    source: 'trade_sweep',
    reason: 'full_empty',
  },
  marketSnapshot: {
    cityName: 'Los Angeles',
    airportCode: 'KLAX',
    temperatureBand: '70°F to 71°F',
    yesPrice: 0.41,
    bestBid: 0.2,
    bestAsk: 0.22,
    spread: 0.02,
  },
  ...overrides,
});

describe('alert notification content', () => {
  it('builds a bilingual city label with airport code', () => {
    const presentation = buildAlertPresentation(buildAlert());

    expect(presentation.cityLabel).toBe('洛杉矶 · KLAX · Los Angeles');
    expect(presentation.cityLabel).toContain('KLAX');
    expect(presentation.cityLabel).toContain('Los Angeles');
    expect(presentation.title).toBe('洛杉矶 · KLAX · Los Angeles · 70 至 71 华氏度');
    expect(presentation.summary).toBe(
      '盘口斩杀：YES 买盘从 20 美分降到 0 美分（疑似成交扫空，该侧现价盘口已整边清空）',
    );
  });

  it('builds a compact city + temperature + key value notification', () => {
    const notification = buildAlertNotificationContent(buildAlert());
    expect(notification.title).toBe('洛杉矶 · KLAX · Los Angeles · 70 至 71 华氏度');
    expect(notification.body).toBe(
      '盘口斩杀 · YES 买盘 20 美分 → 0 美分 · 疑似成交扫空，该侧现价盘口已整边清空 · 当前价格 41 美分',
    );
  });

  it('summarizes temperature ladder liquidity kills with anchor and confirmation bands', () => {
    const alert = buildAlert({
      cityKey: 'warsaw',
      marketId: 'warsaw-13c',
      messageParams: {
        outcome: 'yes',
        side: 'buy',
        direction: 'higher',
        previous: 0.102,
        actual: 0,
        threshold: 0.08,
        source: 'temperature_ladder',
        reason: 'temperature_ladder_high',
        anchorMarketId: 'warsaw-13c',
        anchorTemperatureBand: '13°C',
        confirmationMarketId: 'warsaw-14c',
        confirmationTemperatureBand: '14°C',
      },
      marketSnapshot: {
        cityName: 'Warsaw',
        airportCode: 'EPWA',
        eventDate: '2026-05-09',
        temperatureBand: '13°C',
        yesPrice: 0,
        bestBid: 0,
        bestAsk: 0.01,
        spread: 0.01,
      },
    });

    const presentation = buildAlertPresentation(alert);
    const notification = buildAlertNotificationContent(alert);

    expect(presentation.summary).toContain('高温斩杀');
    expect(presentation.summary).toContain('13 摄氏度 YES');
    expect(presentation.summary).toContain('10 美分');
    expect(presentation.summary).toContain('14 摄氏度 相邻确认');
    expect(presentation.facts).toEqual(
      expect.arrayContaining([
        { label: '斩杀类型', value: '高温斩杀', tone: 'strong' },
        { label: '被斩温度档', value: '13 摄氏度', tone: undefined },
        { label: '相邻确认', value: '14 摄氏度', tone: undefined },
      ]),
    );
    expect(notification.body).toBe(
      '盘口斩杀 · 高温斩杀 · 13 摄氏度 YES 10 美分 → 0 美分 · 14 摄氏度 相邻确认 · 当前价格 0 美分',
    );
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

    expect(notification.body).toBe('价差过宽 · 价差 3 美分 · 阈值 2 美分 · 当前价格 41 美分');
  });

  it('avoids repeating current price for price threshold alerts', () => {
    const notification = buildAlertNotificationContent(
      buildAlert({
        ruleId: 'price-threshold',
        builtinKey: undefined,
        messageKey: 'price_threshold',
        messageParams: {
          actual: 0.41,
          threshold: 0.35,
        },
      }),
    );

    expect(notification.body).toBe('价格阈值 · 价格 41 美分 · 阈值 35 美分 · 当前价差 2 美分');
  });

  it('keeps feed stale notifications short and readable', () => {
    const notification = buildAlertNotificationContent(
      buildAlert({
        ruleId: 'feed-stale',
        builtinKey: 'feed_stale',
        messageKey: 'feed_stale',
        messageParams: {
          lagSec: 90,
        },
      }),
    );

    expect(notification.body).toBe('数据流停滞 · 90 秒未更新 · 当前价格 41 美分');
  });

  it('summarizes volume pricing alerts with price move and effective size', () => {
    const volumeAlert: Partial<AlertPresentationSource> = {
      ruleId: 'volume-pricing',
      builtinKey: 'volume_pricing',
      messageKey: 'volume_pricing',
      messageParams: {
        outcome: 'yes',
        side: 'sell',
        previous: 0.2,
        actual: 0.4,
        threshold: 0.1,
        source: 'book_depth',
        reason: 'ask_pushed_up',
        effectiveSize: 50,
        effectiveNotional: 20,
      },
    };
    const presentation = buildAlertPresentation(buildAlert(volumeAlert));
    const notification = buildAlertNotificationContent(buildAlert(volumeAlert));

    expect(presentation.ruleLabel).toBe('带量定价');
    expect(presentation.summary).toContain('20 美分');
    expect(presentation.summary).toContain('40 美分');
    expect(notification.body).toContain('有效量 50 张 / $20.00');
  });

  it('labels abnormal lottery alerts as a dedicated system rule', () => {
    const abnormalAlert: Partial<AlertPresentationSource> = {
      ruleId: 'abnormal-lottery',
      builtinKey: 'abnormal_lottery',
      messageKey: 'abnormal_lottery',
      messageParams: {
        outcome: 'yes',
        side: 'sell',
        previous: 0.02,
        actual: 0.05,
        threshold: 0.03,
        source: 'book_depth',
        reason: 'ultra_low_ask_lifted',
        effectiveSize: 150,
        effectiveNotional: 7.5,
      },
    };
    const presentation = buildAlertPresentation(buildAlert(abnormalAlert));
    const notification = buildAlertNotificationContent(buildAlert(abnormalAlert));

    expect(presentation.ruleLabel).toBe('异常彩票');
    expect(presentation.summary).toContain('2 美分');
    expect(presentation.summary).toContain('5 美分');
    expect(notification.body).toContain('异常彩票');
    expect(notification.body).toContain('YES');
  });

  it('prefers builtin abnormal lottery identity over a misleading spread message key', () => {
    const expectedLabel = buildAlertPresentation(
      buildAlert({
        ruleId: 'abnormal-lottery',
        builtinKey: 'abnormal_lottery',
        messageKey: 'abnormal_lottery',
      }),
    ).ruleLabel;
    const presentation = buildAlertPresentation(
      buildAlert({
        ruleId: 'abnormal-lottery',
        builtinKey: 'abnormal_lottery',
        messageKey: 'spread_threshold',
        messageParams: {
          actual: 0.03,
          threshold: 0.02,
        },
      }),
    );

    expect(presentation.ruleLabel).toBe(expectedLabel);
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
