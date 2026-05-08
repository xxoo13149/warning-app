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
  onOpenMarket?: (alert: AlertEvent) => void;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const DEFAULT_VIEWPORT_HEIGHT = 760;
const ESTIMATED_CARD_OFFSET = 296;

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

const clickElement = async (element: Element | null) => {
  expect(element).not.toBeNull();

  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
};

const getViewport = () =>
  (container?.querySelector('.alert-center-list-viewport') as HTMLDivElement | null) ?? null;

const scrollViewport = async (top: number) => {
  const viewport = getViewport();
  expect(viewport).not.toBeNull();

  Object.defineProperty(viewport as HTMLDivElement, 'clientHeight', {
    configurable: true,
    value: DEFAULT_VIEWPORT_HEIGHT,
  });

  await act(async () => {
    (viewport as HTMLDivElement).scrollTop = top;
    viewport?.dispatchEvent(new Event('scroll', { bubbles: true }));
    await Promise.resolve();
  });

  return viewport as HTMLDivElement;
};

const renderView = async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  const rerender = async ({
    alerts = [],
    total = alerts.length,
    hasMore = false,
    loadingMore = false,
    onLoadMore = () => undefined,
    loadMoreError = null,
    onOpenMarket,
  }: RenderOptions = {}) => {
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
            onOpenMarket={onOpenMarket}
          />
        </LocaleProvider>,
      );
      await Promise.resolve();
    });
  };

  return { rerender };
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

    const view = await renderView();
    await view.rerender({
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

    const view = await renderView();
    await view.rerender({
      alerts,
      total: 20,
      hasMore: true,
      onLoadMore,
    });

    const filterGroups = container?.querySelectorAll(
      '.alert-center-filter-layout .alert-center-filter-group',
    );
    const cityButtons = Array.from(filterGroups?.[0]?.querySelectorAll('.alert-center-chip') ?? []);
    const ruleButtons = Array.from(filterGroups?.[1]?.querySelectorAll('.alert-center-chip') ?? []);

    await clickElement(cityButtons[1] ?? null);

    let emptiedList = false;
    for (const button of ruleButtons.slice(1)) {
      await clickElement(button);
      if ((container?.querySelectorAll('.alert-center-card').length ?? 0) === 0) {
        emptiedList = true;
        break;
      }
    }

    expect(emptiedList).toBe(true);
    expect(container?.querySelectorAll('.alert-center-card').length).toBe(0);
    expect(container?.textContent).toContain('可以继续加载更早历史');

    const loadMoreButton = container?.querySelector('.ghost-button') as HTMLButtonElement | null;
    expect(loadMoreButton).not.toBeNull();
    expect(loadMoreButton?.disabled).toBe(false);

    await clickElement(loadMoreButton);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('renders a load-more error message when provided without blocking the CTA', async () => {
    const onLoadMore = vi.fn();
    const loadMoreError = 'load more failed';

    const view = await renderView();
    await view.rerender({
      alerts: [],
      total: 12,
      hasMore: true,
      onLoadMore,
      loadMoreError,
    });

    expect(container?.textContent).toContain(loadMoreError);

    const loadMoreButton = container?.querySelector('.ghost-button') as HTMLButtonElement | null;
    expect(loadMoreButton).not.toBeNull();
    expect(loadMoreButton?.disabled).toBe(false);

    await clickElement(loadMoreButton);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('opens the related market when an alert card is clicked', async () => {
    const alert = buildAlert('1');
    const onOpenMarket = vi.fn();

    const view = await renderView();
    await view.rerender({
      alerts: [alert],
      total: 1,
      onOpenMarket,
    });

    const card = container?.querySelector('[data-alert-id="1"]');
    expect(card).not.toBeNull();

    await act(async () => {
      card?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(onOpenMarket).toHaveBeenCalledTimes(1);
    expect(onOpenMarket).toHaveBeenCalledWith(alert);
  });

  it('compresses each alert card into a clear object line and trigger line before navigation', async () => {
    const alert = buildAlert('1', {
      messageKey: 'spread_threshold',
      messageParams: {
        actual: 0.02,
        threshold: 0.01,
        operator: '>',
      },
    });

    const view = await renderView();
    await view.rerender({
      alerts: [alert],
      total: 1,
    });

    const objectLine = container?.querySelector(
      '[data-testid="alert-center-card-object-1"]',
    ) as HTMLElement | null;
    const triggerLine = container?.querySelector(
      '[data-testid="alert-center-card-trigger-1"]',
    ) as HTMLElement | null;
    const locatorCard = container?.querySelector(
      '[data-testid="alert-center-card-locator-1"]',
    ) as HTMLElement | null;

    expect(objectLine).not.toBeNull();
    expect(triggerLine).not.toBeNull();
    expect(locatorCard).not.toBeNull();
    expect(objectLine?.textContent).toContain('market-1');
    expect(objectLine?.textContent).toContain('10');
    expect(objectLine?.textContent).toContain('15');
    expect(triggerLine?.textContent).toContain('触发');
    expect(locatorCard?.textContent).toContain('market-1');
    expect(locatorCard?.textContent).toContain('北京');
  });

  it('keeps the current reading position stable when new alerts are prepended', async () => {
    const alerts = Array.from({ length: 6 }, (_, index) =>
      buildAlert(String(index + 1), {
        triggeredAt: new Date(Date.UTC(2026, 3, 24, 1, 0, 40 - index)).toISOString(),
      }),
    );
    const newestAlert = buildAlert('new', {
      triggeredAt: new Date(Date.UTC(2026, 3, 24, 1, 1, 0)).toISOString(),
    });

    const view = await renderView();
    await view.rerender({
      alerts,
      total: alerts.length,
    });

    await scrollViewport(350);

    const nextAlerts = [newestAlert, ...alerts];
    await view.rerender({
      alerts: nextAlerts,
      total: nextAlerts.length,
    });

    expect(getViewport()?.scrollTop).toBe(350 + ESTIMATED_CARD_OFFSET);

    const latestCta = container?.querySelector(
      '[data-testid="alert-center-latest-cta"]',
    ) as HTMLButtonElement | null;
    expect(latestCta).not.toBeNull();
    expect(latestCta?.textContent).toContain('1');
  });

  it('shows a jump-to-latest entry away from the top and scrolls back when clicked', async () => {
    const alerts = Array.from({ length: 4 }, (_, index) =>
      buildAlert(String(index + 1), {
        triggeredAt: new Date(Date.UTC(2026, 3, 24, 1, 0, 40 - index)).toISOString(),
      }),
    );

    const view = await renderView();
    await view.rerender({
      alerts,
      total: alerts.length,
    });

    await scrollViewport(120);

    const latestCta = container?.querySelector(
      '[data-testid="alert-center-latest-cta"]',
    ) as HTMLButtonElement | null;
    expect(latestCta).not.toBeNull();

    await act(async () => {
      latestCta?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(getViewport()?.scrollTop).toBe(0);
    expect(container?.querySelector('[data-testid="alert-center-latest-cta"]')).toBeNull();
  });
});
