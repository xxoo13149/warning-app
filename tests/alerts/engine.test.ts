import { describe, expect, it } from 'vitest';
import { AlertEngine, type AlertRule } from '../../src/core/alerts';
import { MarketStateStore } from '../../src/core/state';

describe('alert engine for market ticks', () => {
  it('enforces cooldown and dedupe window for threshold alerts', () => {
    const engine = new AlertEngine(new MarketStateStore());

    const rule: AlertRule = {
      id: 'rule-price',
      name: 'Price over 0.60',
      enabled: true,
      metric: 'price_threshold',
      operator: '>=',
      threshold: 0.6,
      windowSec: 120,
      cooldownSec: 60,
      dedupeWindowSec: 15,
      severity: 'high',
    };

    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const first = engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-1',
        marketId: 'market-1',
        cityKey: 'nyc',
        timestamp: t0,
        lastTradePrice: 0.61,
      },
      t0,
    );
    expect(first.length).toBe(1);

    const second = engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-1',
        marketId: 'market-1',
        cityKey: 'nyc',
        timestamp: t0 + 10_000,
        lastTradePrice: 0.62,
      },
      t0 + 10_000,
    );
    expect(second.length).toBe(0);

    const third = engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-1',
        marketId: 'market-1',
        cityKey: 'nyc',
        timestamp: t0 + 61_000,
        lastTradePrice: 0.63,
      },
      t0 + 61_000,
    );
    expect(third.length).toBe(1);
  });

  it('evaluates price change percentage in window and applies scope filter', () => {
    const engine = new AlertEngine(new MarketStateStore());
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);

    const rule: AlertRule = {
      id: 'rule-change',
      name: 'Price changed 5%',
      enabled: true,
      metric: 'price_change_pct',
      operator: '>=',
      threshold: 5,
      windowSec: 300,
      cooldownSec: 0,
      dedupeWindowSec: 0,
      severity: 'medium',
      scope: { cityKey: 'nyc' },
    };

    engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-2',
        marketId: 'market-2',
        cityKey: 'nyc',
        timestamp: t0,
        lastTradePrice: 1.0,
      },
      t0,
    );

    const scopedOut = engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-2',
        marketId: 'market-2',
        cityKey: 'sfo',
        timestamp: t0 + 20_000,
        lastTradePrice: 1.1,
      },
      t0 + 20_000,
    );
    expect(scopedOut.length).toBe(0);

    const scopedIn = engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-2',
        marketId: 'market-2',
        cityKey: 'nyc',
        timestamp: t0 + 40_000,
        lastTradePrice: 1.08,
      },
      t0 + 40_000,
    );
    expect(scopedIn.length).toBe(1);
  });

  it('triggers liquidity kill when bid collapses below threshold', () => {
    const engine = new AlertEngine(new MarketStateStore());
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const rule: AlertRule = {
      id: 'rule-liquidity-kill',
      name: 'Bid liquidity kill',
      enabled: true,
      metric: 'liquidity_kill',
      operator: '<=',
      threshold: 0.01,
      windowSec: 60,
      cooldownSec: 0,
      dedupeWindowSec: 0,
      severity: 'critical',
    };

    const initial = engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-liquidity',
        marketId: 'market-liquidity',
        cityKey: 'nyc',
        timestamp: t0,
        bestBid: 0.2,
      },
      t0,
    );
    expect(initial.length).toBe(0);

    const collapsed = engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-liquidity',
        marketId: 'market-liquidity',
        cityKey: 'nyc',
        timestamp: t0 + 30_000,
        bestBid: 0,
      },
      t0 + 30_000,
    );
    expect(collapsed.length).toBe(1);
    expect(collapsed[0].ruleId).toBe('rule-liquidity-kill');
    expect(collapsed[0].messageKey).toBe('liquidity_kill');
  });

  it('triggers liquidity kill when ask liquidity disappears', () => {
    const engine = new AlertEngine(new MarketStateStore());
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const rule: AlertRule = {
      id: 'rule-liquidity-kill-ask',
      name: 'Ask liquidity kill',
      enabled: true,
      metric: 'liquidity_kill',
      operator: '<=',
      threshold: 0.01,
      windowSec: 60,
      cooldownSec: 0,
      dedupeWindowSec: 0,
      severity: 'critical',
    };

    const initial = engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-liquidity-ask',
        marketId: 'market-liquidity',
        cityKey: 'nyc',
        timestamp: t0,
        bestAsk: 0.2,
      },
      t0,
    );
    expect(initial.length).toBe(0);

    const disappeared = engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-liquidity-ask',
        marketId: 'market-liquidity',
        cityKey: 'nyc',
        timestamp: t0 + 30_000,
      },
      t0 + 30_000,
    );
    expect(disappeared.length).toBe(1);
    expect(disappeared[0].ruleId).toBe('rule-liquidity-kill-ask');
    expect(disappeared[0].messageKey).toBe('liquidity_kill');
    expect(disappeared[0].messageParams?.side).toBe('sell');
  });

  it('uses explicit removed edges to classify probable trade sweeps', () => {
    const engine = new AlertEngine(new MarketStateStore());
    const t0 = Date.UTC(2026, 0, 1, 0, 1, 0);
    const rule: AlertRule = {
      id: 'rule-liquidity-edge',
      name: '盘口斩杀',
      enabled: true,
      metric: 'liquidity_kill',
      operator: '>=',
      threshold: 0.2,
      windowSec: 30,
      cooldownSec: 0,
      dedupeWindowSec: 0,
      severity: 'critical',
      liquiditySide: 'buy',
    };

    const result = engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-edge',
        marketId: 'market-edge',
        cityKey: 'nyc',
        side: 'yes',
        timestamp: t0,
        bestBid: 0.18,
        bidLevelCount: 2,
        removedBidEdge: {
          previousPrice: 0.31,
          previousSize: 4,
          currentPrice: 0.18,
          currentSize: 2,
          levelCountAfter: 2,
          visibleSizeAfter: 6,
          source: 'price_change',
        },
        lastTradeAt: t0,
      },
      t0,
    );

    expect(result).toHaveLength(1);
    expect(result[0].messageParams).toMatchObject({
      outcome: 'yes',
      side: 'buy',
      source: 'trade_sweep',
      reason: 'top_level',
      previous: 0.31,
      actual: 0.18,
    });
  });

  it('respects liquiditySide and uses fallback empty-book detection', () => {
    const engine = new AlertEngine(new MarketStateStore());
    const t0 = Date.UTC(2026, 0, 1, 0, 2, 0);

    engine.evaluateMarketTick(
      [],
      {
        tokenId: 'token-fallback',
        marketId: 'market-fallback',
        cityKey: 'nyc',
        timestamp: t0,
        bestAsk: 0.24,
        askLevelCount: 1,
      },
      t0,
    );

    const buyOnlyRule: AlertRule = {
      id: 'rule-buy-only',
      name: '只看买盘',
      enabled: true,
      metric: 'liquidity_kill',
      operator: '>=',
      threshold: 0.2,
      windowSec: 30,
      cooldownSec: 0,
      dedupeWindowSec: 0,
      severity: 'critical',
      liquiditySide: 'buy',
    };
    const sellOnlyRule: AlertRule = {
      ...buyOnlyRule,
      id: 'rule-sell-only',
      name: '只看卖盘',
      liquiditySide: 'sell',
    };

    const result = engine.evaluateMarketTick(
      [buyOnlyRule, sellOnlyRule],
      {
        tokenId: 'token-fallback',
        marketId: 'market-fallback',
        cityKey: 'nyc',
        timestamp: t0 + 10_000,
        askLevelCount: 0,
      },
      t0 + 10_000,
    );

    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe('rule-sell-only');
    expect(result[0].messageParams).toMatchObject({
      side: 'sell',
      source: 'fallback',
      reason: 'full_empty',
      previous: 0.24,
      actual: 0,
    });
  });

  it('triggers volume pricing when best ask is lifted with depth confirmation', () => {
    const engine = new AlertEngine(new MarketStateStore());
    const t0 = Date.UTC(2026, 0, 1, 0, 3, 0);
    const rule: AlertRule = {
      id: 'rule-volume-pricing',
      name: 'Volume pricing',
      enabled: true,
      metric: 'volume_pricing',
      operator: '>=',
      threshold: 0.1,
      windowSec: 60,
      cooldownSec: 0,
      dedupeWindowSec: 0,
      severity: 'medium',
    };

    engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-volume',
        marketId: 'market-volume',
        cityKey: 'nyc',
        timestamp: t0,
        side: 'yes',
        bestBid: 0.18,
        bestAsk: 0.2,
        bestAskSize: 40,
        spread: 0.02,
      },
      t0,
    );

    const result = engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-volume',
        marketId: 'market-volume',
        cityKey: 'nyc',
        timestamp: t0 + 30_000,
        side: 'yes',
        bestBid: 0.38,
        bestAsk: 0.4,
        bestAskSize: 50,
        spread: 0.02,
      },
      t0 + 30_000,
    );

    expect(result).toHaveLength(1);
    expect(result[0].messageKey).toBe('volume_pricing');
    expect(result[0].messageParams).toMatchObject({
      outcome: 'yes',
      side: 'sell',
      previous: 0.2,
      actual: 0.4,
      source: 'book_depth',
      effectiveSize: 50,
      effectiveNotional: 20,
    });
  });

  it('does not trigger volume pricing without enough trade or book size', () => {
    const engine = new AlertEngine(new MarketStateStore());
    const t0 = Date.UTC(2026, 0, 1, 0, 4, 0);
    const rule: AlertRule = {
      id: 'rule-volume-pricing-small',
      name: 'Volume pricing',
      enabled: true,
      metric: 'volume_pricing',
      operator: '>=',
      threshold: 0.1,
      windowSec: 60,
      cooldownSec: 0,
      dedupeWindowSec: 0,
      severity: 'medium',
    };

    engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-volume-small',
        marketId: 'market-volume',
        cityKey: 'nyc',
        timestamp: t0,
        bestBid: 0.18,
        bestAsk: 0.2,
        spread: 0.02,
      },
      t0,
    );

    const result = engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-volume-small',
        marketId: 'market-volume',
        cityKey: 'nyc',
        timestamp: t0 + 30_000,
        bestBid: 0.38,
        bestAsk: 0.4,
        bestAskSize: 2,
        spread: 0.02,
      },
      t0 + 30_000,
    );

    expect(result).toHaveLength(0);
  });

  it('does not trigger volume pricing when the repriced ask is too far from the bid', () => {
    const engine = new AlertEngine(new MarketStateStore());
    const t0 = Date.UTC(2026, 0, 1, 0, 5, 0);
    const rule: AlertRule = {
      id: 'rule-volume-pricing-wide',
      name: 'Volume pricing',
      enabled: true,
      metric: 'volume_pricing',
      operator: '>=',
      threshold: 0.1,
      windowSec: 60,
      cooldownSec: 0,
      dedupeWindowSec: 0,
      severity: 'medium',
    };

    engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-volume-wide',
        marketId: 'market-volume',
        cityKey: 'nyc',
        timestamp: t0,
        bestBid: 0.18,
        bestAsk: 0.2,
        spread: 0.02,
      },
      t0,
    );

    const result = engine.evaluateMarketTick(
      [rule],
      {
        tokenId: 'token-volume-wide',
        marketId: 'market-volume',
        cityKey: 'nyc',
        timestamp: t0 + 30_000,
        bestBid: 0.1,
        bestAsk: 0.4,
        bestAskSize: 100,
        spread: 0.3,
      },
      t0 + 30_000,
    );

    expect(result).toHaveLength(0);
  });
});
