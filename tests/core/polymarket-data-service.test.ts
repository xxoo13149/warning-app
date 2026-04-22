import { describe, expect, it } from 'vitest';

import type {
  MarketWsMessage,
  TokenRuntimeState,
} from '../../src/core/polymarket/types';
import { PolymarketDataService } from '../../src/core/services/polymarket-data-service';

describe('PolymarketDataService', () => {
  it('maps book events to live bid and ask prices', () => {
    const service = new PolymarketDataService();
    const updates: TokenRuntimeState[] = [];
    service.on('token_state', (payload) => {
      updates.push(payload);
    });

    (
      service as unknown as {
        applyWsEvent(event: MarketWsMessage): void;
      }
    ).applyWsEvent({
      event_type: 'book',
      asset_id: 'token-book',
      bids: [
        { price: '0.39', size: '12' },
        { price: '0.42', size: '3' },
      ],
      asks: [
        { price: '0.47', size: '8' },
        { price: '0.45', size: '2' },
      ],
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      tokenId: 'token-book',
      bestBid: 0.42,
      bestAsk: 0.45,
      spread: 0.03,
      bookBestBid: 0.42,
      bookBestAsk: 0.45,
      lastEventType: 'book',
    });
  });

  it('ignores empty book events before any usable price exists', () => {
    const service = new PolymarketDataService();
    const updates: TokenRuntimeState[] = [];
    service.on('token_state', (payload) => {
      updates.push(payload);
    });

    (
      service as unknown as {
        applyWsEvent(event: MarketWsMessage): void;
      }
    ).applyWsEvent({
      event_type: 'book',
      asset_id: 'token-empty-book',
      bids: [],
      asks: [],
    });

    expect(updates).toHaveLength(0);
  });
});
