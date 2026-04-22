import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestJsonMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
}));

vi.mock('../../src/core/polymarket/http', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/core/polymarket/http')
  >('../../src/core/polymarket/http');
  return {
    ...actual,
    requestJson: requestJsonMock,
  };
});

import { GammaDiscoveryClient } from '../../src/core/polymarket/gamma-discovery';

describe('GammaDiscoveryClient', () => {
  beforeEach(() => {
    requestJsonMock.mockReset();
  });

  it('parses token ids and price seeds from gamma discovery payloads', async () => {
    requestJsonMock.mockResolvedValueOnce([
      {
        id: 'event-1',
        title: 'Los Angeles daily weather',
        seriesSlug: 'los-angeles-daily-weather',
        endDate: '2026-04-22T23:59:59Z',
        active: true,
        closed: false,
        markets: [
          {
            id: 'market-1',
            conditionId: 'condition-1',
            groupItemTitle: '70-71°F',
            outcomes: '["Yes","No"]',
            clobTokenIds: '["token-yes","token-no"]',
            outcomePrices: '["0.41","0.59"]',
            bestBid: '0.39',
            bestAsk: '0.43',
            active: true,
            closed: false,
          },
          {
            id: 'market-2',
            conditionId: 'condition-2',
            groupItemTitle: '72-73°F',
            tokens: [
              { token_id: 'token-yes-2', outcome: 'Yes' },
              { token_id: 'token-no-2', outcome: 'No' },
            ],
            outcomePrices: '["0.22","0.78"]',
            active: true,
            closed: false,
          },
        ],
      },
    ]);

    const client = new GammaDiscoveryClient();
    const universe = await client.discoverDailyWeatherUniverse({
      cityConfigs: [
        {
          cityKey: 'los-angeles',
          displayName: 'Los Angeles',
          seriesSlug: 'los-angeles-daily-weather',
          airportCode: 'LAX',
          timezone: 'America/Los_Angeles',
          enabled: true,
        },
      ],
      active: true,
      closed: false,
    });

    expect(universe.eventCount).toBe(1);
    expect(universe.marketCount).toBe(2);

    expect(universe.markets[0]).toMatchObject({
      yesTokenId: 'token-yes',
      noTokenId: 'token-no',
      priceSeed: {
        yes: {
          lastTradePrice: 0.41,
          bestBid: 0.39,
          bestAsk: 0.43,
        },
        no: {
          lastTradePrice: 0.59,
          bestBid: 0.57,
          bestAsk: 0.61,
        },
      },
    });

    expect(universe.markets[1]).toMatchObject({
      yesTokenId: 'token-yes-2',
      noTokenId: 'token-no-2',
      priceSeed: {
        yes: {
          lastTradePrice: 0.22,
        },
        no: {
          lastTradePrice: 0.78,
        },
      },
    });
  });
});
