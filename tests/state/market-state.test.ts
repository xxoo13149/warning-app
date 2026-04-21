import { describe, expect, it } from 'vitest';
import { MarketStateStore } from '../../src/core/state';

describe('market state store', () => {
  it('keeps latest tick and prunes history by max window', () => {
    const store = new MarketStateStore(60_000);
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);

    store.recordTick({
      tokenId: 'token-1',
      marketId: 'market-1',
      timestamp: t0,
      lastTradePrice: 0.51,
    });
    store.recordTick({
      tokenId: 'token-1',
      marketId: 'market-1',
      timestamp: t0 + 30_000,
      lastTradePrice: 0.52,
    });
    store.recordTick({
      tokenId: 'token-1',
      marketId: 'market-1',
      timestamp: t0 + 90_000,
      lastTradePrice: 0.53,
    });

    const latest = store.getLatest('token-1');
    expect(latest?.lastTradePrice).toBe(0.53);

    const history = store.getHistory('token-1', 60_000, t0 + 90_000);
    expect(history.length).toBe(2);
    expect(history[0]?.timestamp).toBe(t0 + 30_000);
  });
});
