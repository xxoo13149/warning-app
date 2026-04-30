// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '../../src/renderer/i18n';
import type { AlertEvent } from '../../src/renderer/types/contracts';
import { AlertCenterView } from '../../src/renderer/views/AlertCenterView';

interface RenderOptions {
  alerts?: AlertEvent[];
  total?: number;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  loadMoreError?: string | null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

const buildAlert = (
  id: string,
  overrides: Partial<AlertEvent> = {},
): AlertEvent => ({
  id,
  ruleId: 'spread-threshold',
  triggeredAt: '2026-04-24T01:00:00.000Z',
  cityKey: 'beijing',
  marketId: `market-${id}`,
  tokenId: `token-${id}`,
  message: 'spread alert detected',
  severity: 'warning',
  acknowledged: false,
  marketSnapshot: {
    eventDate: '2026-04-24',
    temperatureBand: '10 C to 15 C',
    yesPrice: 0.56,
    bestBid: 0.55,
    bestAsk: 0.57,
    spread: 0.02,
    change5m: 1.5,
  },
  ...overrides,
});

const findButtonByText = (text: string): HTMLButtonElement | null => {
  const buttons = Array.from(container?.querySelectorAll('button') ?? []);
  return (
    buttons.find((button) => button.textContent?.includes(text)) as HTMLButtonElement | undefined
  ) ?? null;
};

const clickButton = async (text: string) => {
  const button = findButtonByText(text);
  expect(button).not.toBeNull();

  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });

  return button;
};

const renderView = async ({
  alerts = [],
  total = alerts.length,
  hasMore = false,
  loadingMore = false,
  onLoadMore = () => undefined,
  loadMoreError = null,
}: RenderOptions = {}) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <LocaleProvider>
        <AlertCenterView
          alerts={alerts}
          total={total}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={onLoadMore}
          loadMoreError={loadMoreError}
        />
      </LocaleProvider>,
    );
    await Promise.resolve();
  });
};

beforeEach(() => {
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await Promise.resolve();
    });
  }

  root = null;
  container?.remove();
  container = null;
  window.localStorage.clear();
  testGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('AlertCenterView', () => {
  it('virtualizes long alert histories instead of rendering every card at once', async () => {
    const alerts = Array.from({ length: 40 }, (_, index) =>
      buildAlert(String(index + 1), {
        triggeredAt: new Date(Date.UTC(2026, 3, 24, 1, 0, 40 - index)).toISOString(),
      }),
    );

    await renderView({
      alerts,
      total: alerts.length,
    });

    const renderedCards = container?.querySelectorAll('.alert-center-card') ?? [];
    expect(renderedCards.length).toBeGreaterThan(0);
    expect(renderedCards.length).toBeLessThan(alerts.length);
    expect(container?.textContent).toContain('market-1');
  });

  it('keeps a clickable load-more path when filters temporarily empty the visible alerts', async () => {
    const onLoadMore = vi.fn();
    const alerts = [
      buildAlert('1', { cityKey: 'beijing', ruleId: 'spread-threshold' }),
      buildAlert('2', { cityKey: 'london', ruleId: 'liquidity-kill' }),
    ];

    await renderView({
      alerts,
      total: 20,
      hasMore: true,
      onLoadMore,
    });

    await clickButton('北京');
    await clickButton('盘口斩杀');

    expect(container?.querySelectorAll('.alert-center-card').length).toBe(0);
    expect(container?.textContent).toContain('继续加载更早历史');

    const loadMoreButton = findButtonByText('加载更多');
    expect(loadMoreButton).not.toBeNull();
    expect(loadMoreButton?.disabled).toBe(false);

    await clickButton('加载更多');
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('renders a load-more error message when provided without blocking the CTA', async () => {
    const onLoadMore = vi.fn();

    await renderView({
      alerts: [],
      total: 12,
      hasMore: true,
      onLoadMore,
      loadMoreError: '加载更早历史失败，请稍后重试。',
    });

    expect(container?.textContent).toContain('加载更早历史失败，请稍后重试。');

    const loadMoreButton = findButtonByText('加载更多');
    expect(loadMoreButton).not.toBeNull();
    expect(loadMoreButton?.disabled).toBe(false);

    await clickButton('加载更多');
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
