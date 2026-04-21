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
});
