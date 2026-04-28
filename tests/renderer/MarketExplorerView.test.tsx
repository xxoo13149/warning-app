// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '../../src/renderer/i18n';
import type { MarketQuery, MarketRow } from '../../src/renderer/types/contracts';
import { MarketExplorerView } from '../../src/renderer/views/MarketExplorerView';

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
testGlobal.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const buildMarket = (index: number, overrides: Partial<MarketRow> = {}): MarketRow => {
  const cityIndex = Math.floor(index / 10);
  return {
    marketId: `market-${index}`,
    cityKey: `city-${cityIndex}`,
    cityName: `City ${cityIndex}`,
    airportCode: `K${String(cityIndex).padStart(3, '0')}`,
    eventDate: '2026-04-26',
    temperatureBand: `${60 + index}F to ${61 + index}F`,
    side: 'BOTH',
    yesPrice: 0.42,
    noPrice: 0.58,
    bestBid: 0.41,
    bestAsk: 0.43,
    spread: 0.02,
    change5m: 1.1,
    volume24h: 1200 - index,
    status: 'active',
    bubbleScore: 30,
    bubbleSeverity: 'warning',
    bubbleUpdatedAt: '2026-04-25T00:00:00.000Z',
    updatedAt: '2026-04-25T00:00:00.000Z',
    watchlisted: false,
    ...overrides,
  };
};

const renderView = async (rows: MarketRow[], query: MarketQuery = {}) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LocaleProvider>
        <MarketExplorerView
          rows={rows}
          total={rows.length}
          query={query}
          onQueryChange={vi.fn()}
          onRefresh={vi.fn()}
        />
      </LocaleProvider>,
    );
  });
  return container;
};

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

describe('MarketExplorerView', () => {
  it('caps the first-screen overview and precision table while nudging users to filter', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => buildMarket(index));
    const view = await renderView(rows);

    expect(view.querySelectorAll('.market-city-group')).toHaveLength(8);
    expect(view.querySelectorAll('.market-band')).toHaveLength(48);
    expect(view.textContent).toContain('输入城市、机场代码或中文名继续筛选');

    const preciseButton = view.querySelectorAll('.market-explorer-view-toggle button')[1];
    await act(async () => {
      preciseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(view.querySelectorAll('tbody .market-table-row')).toHaveLength(80);
    expect(view.textContent).toContain('精确列表已限制展示前 80 行');
  });
});
