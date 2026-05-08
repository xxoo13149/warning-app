// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '../../src/renderer/i18n';
import type { AlertEvent, MarketQuery, MarketRow } from '../../src/renderer/types/contracts';
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

const buildAlert = (
  id: string,
  overrides: Partial<AlertEvent> = {},
): AlertEvent => ({
  id,
  ruleId: 'spread-threshold',
  triggeredAt: '2026-04-24T01:00:00.000Z',
  cityKey: 'city-0',
  marketId: 'market-0',
  tokenId: `token-${id}`,
  message: 'spread alert detected',
  messageKey: 'spread_threshold',
  messageParams: {
    actual: 0.02,
    threshold: 0.01,
    operator: '>',
  },
  severity: 'warning',
  acknowledged: false,
  marketSnapshot: {
    cityName: 'City 0',
    airportCode: 'K000',
    eventDate: '2026-04-26',
    temperatureBand: '62F to 63F',
    yesPrice: 0.42,
    bestBid: 0.41,
    bestAsk: 0.43,
    spread: 0.02,
    change5m: 1.1,
  },
  ...overrides,
});

const renderView = async (
  rows: MarketRow[],
  query: MarketQuery = {},
  handlers: Partial<{
    onQueryChange: (next: Partial<MarketQuery>) => void;
    onRefresh: () => void;
  }> = {},
  options: {
    focusMarketId?: string | null;
    focusAlert?: AlertEvent | null;
  } = {},
) => {
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
          focusMarketId={options.focusMarketId}
          focusAlert={options.focusAlert}
          onQueryChange={handlers.onQueryChange ?? vi.fn()}
          onRefresh={handlers.onRefresh ?? vi.fn()}
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
    expect(view.querySelectorAll('.market-explorer-limit-hint').length).toBeGreaterThan(0);

    const preciseButton = view.querySelectorAll('.market-explorer-view-toggle button')[1];
    await act(async () => {
      preciseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(view.querySelectorAll('tbody .market-table-row')).toHaveLength(80);
    expect(view.querySelectorAll('.market-explorer-limit-hint').length).toBeGreaterThan(0);
  });

  it('keeps abnormal lottery as market context instead of exposing a preset mode', async () => {
    const onQueryChange = vi.fn();
    const rows = [
      buildMarket(0, {
        lotteryCandidate: true,
        lotteryReferenceAsk: 0.02,
        lotteryCurrentAsk: 0.05,
        lotteryLift: 0.03,
        lotteryConfirmationSource: 'trade_confirmed',
        lotteryEffectiveSize: 120,
        lotteryEffectiveNotional: 6,
        lotteryUpdatedAt: '2026-04-25T00:05:00.000Z',
      }),
      buildMarket(1),
    ];

    const view = await renderView(rows, {}, { onQueryChange });

    expect(view.querySelector('.market-band__badge--lottery')?.textContent).toContain('+');
    expect(view.querySelector('.market-inspector__lottery')).not.toBeNull();
    expect(view.querySelectorAll('.market-explorer-preset')).toHaveLength(2);

    const watchlistPreset = view.querySelectorAll('.market-explorer-preset')[1];
    await act(async () => {
      watchlistPreset?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onQueryChange).toHaveBeenCalledWith(
      expect.objectContaining({
        watchlistedOnly: true,
        side: undefined,
      }),
    );
  });

  it('pins the focused city group into the first-screen overview when it would otherwise fall below the fold', async () => {
    const rows = Array.from({ length: 90 }, (_, index) => buildMarket(index));
    const view = await renderView(rows, {}, {}, { focusMarketId: 'market-80' });

    const focusedGroup = view.querySelector('.market-city-group.is-focused');
    expect(focusedGroup).not.toBeNull();
    expect(view.querySelector('.market-city-group')?.textContent).toContain('City 8');
    expect(focusedGroup?.textContent).toContain('已定位盘口');
    expect(focusedGroup?.textContent).toContain('City 8');
    expect(view.querySelector('.market-band.is-selected')?.textContent).toContain('140');
  });

  it('keeps the focused market visible inside the overview city card even beyond the default row cap', async () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      buildMarket(index, {
        cityKey: 'city-0',
        cityName: 'City 0',
      }),
    );
    const view = await renderView(rows, {}, {}, { focusMarketId: 'market-7' });

    expect(view.querySelectorAll('.market-band')).toHaveLength(6);
    const selectedBand = view.querySelector('.market-band.is-selected');
    expect(selectedBand).not.toBeNull();
    expect(selectedBand?.textContent).toContain('67');
    expect(selectedBand?.textContent).toContain('68');
  });

  it('surfaces the hottest risk band directly in the overview city header', async () => {
    const rows = [
      buildMarket(0, {
        cityKey: 'city-0',
        cityName: 'City 0',
        temperatureBand: '60F to 61F',
        bubbleSeverity: 'warning',
        spread: 0.02,
        change5m: 0.5,
      }),
      buildMarket(1, {
        cityKey: 'city-0',
        cityName: 'City 0',
        temperatureBand: '61F to 62F',
        bubbleSeverity: 'critical',
        spread: 0.08,
        change5m: 4.2,
      }),
      buildMarket(2, {
        cityKey: 'city-0',
        cityName: 'City 0',
        temperatureBand: '62F to 63F',
        bubbleSeverity: 'warning',
        spread: 0.03,
        change5m: 1.1,
      }),
    ];
    const view = await renderView(rows);

    const signal = view.querySelector('[data-testid="market-city-group-signal-city-0"]');
    expect(signal).not.toBeNull();
    expect(signal?.textContent).toContain('61');
    expect(signal?.textContent).toContain('62');
    expect(signal?.textContent).toContain('价差偏高');
  });

  it('keeps alert jumps in overview while focusing the requested market', async () => {
    const rows = [buildMarket(0), buildMarket(1), buildMarket(2)];
    const view = await renderView(rows, {}, {}, { focusMarketId: 'market-2' });

    const selectedBand = view.querySelector('.market-band.is-selected');
    expect(selectedBand).not.toBeNull();
    expect(view.querySelector('tbody .market-table-row')).toBeNull();
    expect(selectedBand?.textContent).toContain('62');
    expect(selectedBand?.textContent).toContain('63');
    expect(view.querySelector('.market-inspector__header strong')?.textContent).toContain('City 0');
    expect(view.querySelector('.market-inspector__header em')?.textContent).toContain('62');
  });

  it('can focus the requested market from alert context alone', async () => {
    const rows = [buildMarket(0), buildMarket(1), buildMarket(2)];
    const view = await renderView(rows, {}, {}, {
      focusAlert: buildAlert('alert-2', {
        marketId: 'market-2',
        cityKey: 'city-0',
      }),
    });

    const selectedBand = view.querySelector('.market-band.is-selected');
    expect(selectedBand).not.toBeNull();
    expect(selectedBand?.textContent).toContain('62');
    expect(selectedBand?.textContent).toContain('63');
    expect(view.querySelector('.market-inspector__header strong')?.textContent).toContain('City 0');
  });

  it.skip('renders an alert entry strip and spotlight card for alert-driven explorer jumps', async () => {
    const rows = [buildMarket(0), buildMarket(1), buildMarket(2)];
    const view = await renderView(rows, {}, {}, {
      focusAlert: buildAlert('alert-spotlight', {
        marketId: 'market-2',
        cityKey: 'city-0',
      }),
    });

    const entry = view.querySelector('[data-testid="market-alert-entry"]');
    const spotlight = view.querySelector('[data-testid="market-alert-spotlight"]');

    expect(entry).not.toBeNull();
    expect(spotlight).not.toBeNull();
    expect(entry?.textContent).toContain('City 0');
    expect(entry?.textContent).toContain('market-2');
    expect(entry?.textContent).toContain('瑙﹀彂');
    expect(spotlight?.textContent).toContain('market-2');
    expect(spotlight?.textContent).toContain('瑙﹀彂');
    expect(spotlight?.textContent).toContain('2 美分');
  });

  it.skip('surfaces object-first and trigger-first copy in the alert entry and spotlight', async () => {
    const rows = [buildMarket(0), buildMarket(1), buildMarket(2)];
    const view = await renderView(rows, {}, {}, {
      focusAlert: buildAlert('alert-spotlight-copy', {
        marketId: 'market-2',
        cityKey: 'city-0',
      }),
    });

    const entry = view.querySelector('[data-testid="market-alert-entry"]');
    const spotlight = view.querySelector('[data-testid="market-alert-spotlight"]');

    expect(entry).not.toBeNull();
    expect(spotlight).not.toBeNull();
    expect(entry?.textContent).toContain('market-2');
    expect(entry?.textContent).toContain('City 0');
    expect(entry?.textContent).toContain('触发');
    expect(spotlight?.textContent).toContain('market-2');
    expect(spotlight?.textContent).toContain('触发');
    expect(spotlight?.textContent).toContain('2 缇庡垎');
  });

  it('keeps the alert entry and spotlight focused on the market object instead of the raw backend message', async () => {
    const rows = [buildMarket(0), buildMarket(1), buildMarket(2)];
    const view = await renderView(rows, {}, {}, {
      focusAlert: buildAlert('alert-spotlight-humanized', {
        marketId: 'market-2',
        cityKey: 'city-0',
      }),
    });

    const entry = view.querySelector('[data-testid="market-alert-entry"]');
    const spotlight = view.querySelector('[data-testid="market-alert-spotlight"]');

    expect(entry).not.toBeNull();
    expect(spotlight).not.toBeNull();
    expect(entry?.textContent).toContain('原始盘口');
    expect(entry?.textContent).toContain('market-2');
    expect(entry?.textContent).toContain('City 0');
    expect(entry?.textContent).toContain('41');
    expect(entry?.textContent).toContain('对照盘口');
    expect(entry?.textContent).not.toContain('spread alert detected');
    expect(spotlight?.textContent).toContain('已定位原始盘口');
    expect(spotlight?.textContent).toContain('market-2');
    expect(spotlight?.textContent).toContain('41');
    expect(spotlight?.textContent).toContain('对照盘口');
    expect(spotlight?.textContent).not.toContain('spread alert detected');
  });

  it('upgrades the inspector with alert analysis and compare cards', async () => {
    const rows = [buildMarket(0), buildMarket(1), buildMarket(2)];
    const view = await renderView(rows, {}, {}, {
      focusAlert: buildAlert('alert-inspector', {
        marketId: 'market-2',
        cityKey: 'city-0',
      }),
    });

    const trigger = view.querySelector('[data-testid="market-inspector-trigger"]');
    const triggerFlow = view.querySelector('[data-testid="market-inspector-trigger-flow"]');
    const triggerRail = view.querySelector('[data-testid="market-inspector-trigger-rail"]');
    const triggerStrip = view.querySelector('[data-testid="market-inspector-trigger-strip"]');
    const analysis = view.querySelector('[data-testid="market-inspector-analysis"]');
    const compare = view.querySelector('[data-testid="market-inspector-compare"]');

    expect(trigger).not.toBeNull();
    expect(triggerFlow).not.toBeNull();
    expect(triggerRail).not.toBeNull();
    expect(triggerStrip).toBeNull();
    expect(analysis).not.toBeNull();
    expect(compare).not.toBeNull();
    expect(trigger?.textContent).toContain('market-2');
    expect(triggerFlow?.textContent).toContain('market-2');
    expect(triggerFlow?.querySelectorAll('.market-inspector__trigger-step')).toHaveLength(3);
    expect(trigger?.textContent).toContain('阈值');
    expect(analysis?.textContent).toContain('告警拆解');
    expect(compare?.textContent).toContain('关键对比');
    expect(compare?.textContent).toContain('YES');
    expect(compare?.textContent).toContain('阈值');
  });

  it('shows same-city related markets and opens precise mode from the secondary entry', async () => {
    const rows = [buildMarket(0), buildMarket(1), buildMarket(2)];
    const view = await renderView(rows, {}, {}, {
      focusAlert: buildAlert('alert-related', {
        marketId: 'market-2',
        cityKey: 'city-0',
      }),
    });

    const related = view.querySelector('[data-testid="market-alert-related"]');
    const preciseEntry = view.querySelector(
      '[data-testid="market-alert-open-precise"]',
    ) as HTMLButtonElement | null;

    expect(related).not.toBeNull();
    expect(related?.querySelectorAll('.market-alert-related__item')).toHaveLength(3);
    expect(preciseEntry).not.toBeNull();

    await act(async () => {
      preciseEntry?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(view.querySelectorAll('tbody .market-table-row')).toHaveLength(3);
  });

  it('keeps precise mode anchored on the alert context while allowing side-by-side comparison', async () => {
    const rows = [buildMarket(0, { spread: 0.04 }), buildMarket(1), buildMarket(2)];
    const view = await renderView(rows, {}, {}, {
      focusAlert: buildAlert('alert-precise-focus', {
        marketId: 'market-2',
        cityKey: 'city-0',
      }),
    });

    const preciseEntry = view.querySelector(
      '[data-testid="market-alert-open-precise"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      preciseEntry?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const preciseFocus = view.querySelector('[data-testid="market-precision-focus"]');
    const inspectorContext = view.querySelector('[data-testid="market-inspector-context"]');
    const inspectorTrigger = view.querySelector('[data-testid="market-inspector-trigger"]');
    const inspectorTriggerStrip = view.querySelector(
      '[data-testid="market-inspector-trigger-strip"]',
    ) as HTMLElement | null;
    const inspectorTriggerFlow = view.querySelector('[data-testid="market-inspector-trigger-flow"]');
    const inspectorAnalysis = view.querySelector('[data-testid="market-inspector-analysis"]');
    const inspectorCompare = view.querySelector('[data-testid="market-inspector-compare"]');
    const precisionGuide = view.querySelector(
      '[data-testid="market-precision-guide"]',
    ) as HTMLElement | null;
    const precisionGuideMarket = view.querySelector(
      '[data-testid="market-precision-guide-fact-market"]',
    ) as HTMLElement | null;
    const precisionGuideActual = view.querySelector(
      '[data-testid="market-precision-guide-fact-actual"]',
    ) as HTMLElement | null;
    const precisionGuideThreshold = view.querySelector(
      '[data-testid="market-precision-guide-fact-threshold"]',
    ) as HTMLElement | null;
    const precisionGuideScope = view.querySelector(
      '[data-testid="market-precision-guide-fact-scope"]',
    ) as HTMLElement | null;
    const precisionGuideCompare = view.querySelector(
      '[data-testid="market-precision-guide-fact-compare"]',
    ) as HTMLElement | null;
    const precisionGuideRail = view.querySelector(
      '[data-testid="market-precision-guide-rail"]',
    ) as HTMLElement | null;
    const precisionGuideContext = view.querySelector(
      '[data-testid="market-precision-guide-fact-context"]',
    ) as HTMLElement | null;
    const judgementPanel = view.querySelector(
      '[data-testid="market-precision-judgement-panel"]',
    ) as HTMLElement | null;
    const judgementPrimary = view.querySelector(
      '[data-testid="market-precision-judgement-primary"]',
    ) as HTMLElement | null;
    const judgementContext = view.querySelector(
      '[data-testid="market-precision-judgement-context"]',
    ) as HTMLElement | null;
    const precisionTable = view.querySelector('.market-precision-table') as HTMLElement | null;
    const spreadHeader = view.querySelector(
      '[data-testid="market-precision-header-spread"]',
    ) as HTMLTableCellElement | null;
    expect(preciseFocus).not.toBeNull();
    expect(inspectorContext).not.toBeNull();
    expect(inspectorTrigger).not.toBeNull();
    expect(inspectorTriggerStrip).not.toBeNull();
    expect(inspectorTriggerFlow).toBeNull();
    expect(inspectorAnalysis).toBeNull();
    expect(inspectorCompare).toBeNull();
    expect(precisionGuide).not.toBeNull();
    expect(precisionGuideMarket).toBeNull();
    expect(precisionGuideActual).toBeNull();
    expect(precisionGuideThreshold).toBeNull();
    expect(precisionGuideRail).toBeNull();
    expect(precisionGuideContext).not.toBeNull();
    expect(judgementPanel).not.toBeNull();
    expect(judgementPrimary).not.toBeNull();
    expect(judgementContext).not.toBeNull();
    expect(precisionTable).not.toBeNull();
    expect(precisionGuideScope).toBeNull();
    expect(precisionGuideCompare).toBeNull();
    expect(spreadHeader).not.toBeNull();
    expect(preciseFocus?.querySelectorAll('.market-precision-focus__pill')).toHaveLength(2);
    expect(preciseFocus?.textContent).toContain('market-2');
    expect(preciseFocus?.textContent).toContain('原始盘口');
    expect(inspectorContext?.textContent).toContain('原始盘口');
    expect(inspectorContext?.textContent).toContain('market-2');
    expect(inspectorContext?.textContent).toContain('已定位到原始盘口');
    expect(inspectorTrigger?.textContent).toContain('辅助核对');
    expect(inspectorTriggerStrip?.textContent).toContain('market-2');
    expect(precisionGuide?.getAttribute('data-focus-column')).toBe('spread');
    expect(precisionGuide?.getAttribute('data-focus-mode')).toBe('alert');
    expect(judgementPanel?.getAttribute('data-focus-column')).toBe('spread');
    expect(judgementPanel?.getAttribute('data-focus-mode')).toBe('alert');
    expect(judgementPanel?.getAttribute('data-selected-market-id')).toBe('market-2');
    expect(judgementPrimary?.textContent).toContain('market-2');
    expect(judgementContext?.textContent).toContain('原始盘口');
    expect(
      Boolean(
        precisionTable &&
          judgementPanel &&
          (judgementPanel.compareDocumentPosition(precisionTable) & Node.DOCUMENT_POSITION_FOLLOWING),
      ),
    ).toBe(true);
    expect(precisionGuideContext?.textContent).toContain('原始盘口');
    expect(precisionGuideContext?.textContent).toContain('market-2');
    expect(view.querySelector('[data-testid="market-precision-guide-context-action"]')).toBeNull();
    expect(spreadHeader?.className).toContain('is-focus-column');

    const alertRow = view.querySelector(
      '[data-testid="market-precision-row-market-2"]',
    ) as HTMLTableRowElement | null;
    const alertRowTrigger = view.querySelector(
      '[data-testid="market-precision-row-trigger-market-2"]',
    ) as HTMLElement | null;
    const alertFocusBadge = view.querySelector(
      '[data-testid="market-precision-focus-badge-market-2"]',
    ) as HTMLElement | null;
    expect(alertRow).not.toBeNull();
    expect(alertRowTrigger).not.toBeNull();
    expect(alertFocusBadge).not.toBeNull();
    expect(alertRow?.className).toContain('is-selected');
    expect(alertRow?.className).toContain('is-alert-focus');
    expect(alertRow?.textContent).toContain('market-2');
    expect(alertRow?.textContent).toContain('原始盘口');
    expect(alertRow?.textContent).toContain('当前盘口');
    expect(alertFocusBadge?.textContent).toContain('告警值');
    expect(alertRowTrigger?.textContent).toContain('触发');

    const comparisonRow = view.querySelector(
      '[data-testid="market-precision-row-market-0"]',
    ) as HTMLTableRowElement | null;
    expect(comparisonRow).not.toBeNull();

    await act(async () => {
      comparisonRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const comparisonFocusBadge = view.querySelector(
      '[data-testid="market-precision-focus-badge-market-0"]',
    ) as HTMLElement | null;
    const comparisonFocusDelta = view.querySelector(
      '[data-testid="market-precision-focus-delta-market-0"]',
    ) as HTMLElement | null;
    const comparisonGuideContext = view.querySelector(
      '[data-testid="market-precision-guide-fact-context"]',
    ) as HTMLButtonElement | null;
    const comparisonGuideContextAction = view.querySelector(
      '[data-testid="market-precision-guide-context-action"]',
    ) as HTMLElement | null;
    const comparisonGuideScope = view.querySelector(
      '[data-testid="market-precision-guide-fact-scope"]',
    ) as HTMLElement | null;
    const comparisonGuideCompare = view.querySelector(
      '[data-testid="market-precision-guide-fact-compare"]',
    ) as HTMLElement | null;
    const comparisonJudgementPanel = view.querySelector(
      '[data-testid="market-precision-judgement-panel"]',
    ) as HTMLElement | null;
    const comparisonJudgementContext = view.querySelector(
      '[data-testid="market-precision-judgement-context"]',
    ) as HTMLElement | null;
    const comparisonJudgementAction = view.querySelector(
      '[data-testid="market-precision-judgement-action"]',
    ) as HTMLButtonElement | null;

    expect(preciseFocus?.textContent).toContain('对照盘口');
    expect(inspectorContext?.textContent).toContain('对照盘口');
    expect(inspectorContext?.textContent).toContain('market-0');
    expect(inspectorContext?.textContent).toContain('market-2');
    expect(inspectorContext?.textContent).toContain('当前为对照盘口');
    expect(alertRow?.className).toContain('is-alert-focus');
    expect(alertRow?.className.includes('is-selected')).toBe(false);
    expect(comparisonRow?.className).toContain('is-selected');
    expect(comparisonRow?.className.includes('is-alert-focus')).toBe(false);
    expect(comparisonRow?.textContent).toContain('对照盘口');
    expect(precisionGuide?.getAttribute('data-focus-mode')).toBe('compare');
    expect(comparisonJudgementPanel?.getAttribute('data-focus-mode')).toBe('compare');
    expect(comparisonJudgementPanel?.getAttribute('data-selected-market-id')).toBe('market-0');
    expect(preciseFocus?.querySelectorAll('.market-precision-focus__pill')).toHaveLength(2);
    expect(comparisonGuideContext).not.toBeNull();
    expect(comparisonGuideContextAction).not.toBeNull();
    expect(comparisonGuideScope).toBeNull();
    expect(comparisonGuideCompare).toBeNull();
    expect(comparisonJudgementContext).not.toBeNull();
    expect(comparisonJudgementAction).not.toBeNull();
    expect(comparisonGuideContext?.textContent).toContain('对照盘口');
    expect(comparisonGuideContext?.textContent).toContain('market-0');
    expect(comparisonGuideContextAction?.textContent).toContain('切回原始盘口');
    expect(comparisonJudgementContext?.textContent).toContain('当前盘口');
    expect(comparisonJudgementContext?.textContent).toContain('market-0');
    expect(comparisonJudgementContext?.textContent).toContain('对照盘口');
    expect(comparisonFocusBadge?.textContent).toContain('对照值');
    expect(comparisonFocusDelta).not.toBeNull();
    expect(comparisonFocusDelta?.textContent).toContain('+');
    expect(comparisonFocusDelta?.textContent).toContain('2');

    expect(view.querySelector('[data-testid="market-precision-return-alert"]')).toBeNull();

    await act(async () => {
      comparisonJudgementAction?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const restoredGuideContext = view.querySelector(
      '[data-testid="market-precision-guide-fact-context"]',
    ) as HTMLElement | null;
    const restoredJudgementPanel = view.querySelector(
      '[data-testid="market-precision-judgement-panel"]',
    ) as HTMLElement | null;
    expect(view.querySelector('[data-testid="market-precision-return-alert"]')).toBeNull();
    expect(preciseFocus?.textContent).toContain('原始盘口');
    expect(inspectorContext?.textContent).toContain('原始盘口');
    expect(precisionGuide?.getAttribute('data-focus-mode')).toBe('alert');
    expect(restoredJudgementPanel?.getAttribute('data-focus-mode')).toBe('alert');
    expect(restoredJudgementPanel?.getAttribute('data-selected-market-id')).toBe('market-2');
    expect(restoredGuideContext?.textContent).toContain('原始盘口');
    expect(view.querySelector('[data-testid="market-precision-guide-context-action"]')).toBeNull();
    expect(alertRow?.className).toContain('is-selected');
    expect(alertRow?.className).toContain('is-alert-focus');
  });

  const precisionFocusCases: Array<{
    name: string;
    expectedColumn: 'yesPrice' | 'bid' | 'ask';
    alertOverrides: Partial<AlertEvent>;
  }> = [
    {
      name: 'price threshold',
      expectedColumn: 'yesPrice',
      alertOverrides: {
        ruleId: 'price-threshold',
        messageKey: 'price_threshold' as const,
        messageParams: {
          actual: 0.42,
          threshold: 0.4,
          operator: '>',
        },
      },
    },
    {
      name: 'volume pricing',
      expectedColumn: 'ask',
      alertOverrides: {
        ruleId: 'volume-pricing',
        messageKey: 'volume_pricing' as const,
        messageParams: {
          actual: 0.43,
          previous: 0.41,
          threshold: 0.02,
          operator: '>=',
          outcome: 'yes',
        },
      },
    },
    {
      name: 'liquidity kill on ask',
      expectedColumn: 'ask',
      alertOverrides: {
        ruleId: 'liquidity-kill',
        messageKey: 'liquidity_kill' as const,
        messageParams: {
          actual: 0,
          previous: 0.43,
          threshold: 0.2,
          operator: '>=',
          side: 'sell',
          outcome: 'yes',
        },
      },
    },
    {
      name: 'liquidity kill on bid',
      expectedColumn: 'bid',
      alertOverrides: {
        ruleId: 'liquidity-kill',
        messageKey: 'liquidity_kill' as const,
        messageParams: {
          actual: 0,
          previous: 0.41,
          threshold: 0.2,
          operator: '>=',
          side: 'buy',
          outcome: 'yes',
        },
      },
    },
  ];

  it.each(precisionFocusCases)(
    'maps $name alerts to the $expectedColumn focus column in precise mode',
    async ({ alertOverrides, expectedColumn }) => {
      const rows = [buildMarket(0), buildMarket(1), buildMarket(2)];
      const view = await renderView(rows, {}, {}, {
        focusAlert: buildAlert(`alert-focus-${expectedColumn}`, {
          marketId: 'market-0',
          cityKey: 'city-0',
          ...alertOverrides,
        }),
      });

      const preciseEntry = view.querySelector(
        '[data-testid="market-alert-open-precise"]',
      ) as HTMLButtonElement | null;

      await act(async () => {
        preciseEntry?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const precisionGuide = view.querySelector(
        '[data-testid="market-precision-guide"]',
      ) as HTMLElement | null;
      const focusHeader = view.querySelector(
        `[data-testid="market-precision-header-${expectedColumn}"]`,
      ) as HTMLTableCellElement | null;

      expect(precisionGuide).not.toBeNull();
      expect(focusHeader).not.toBeNull();
      expect(precisionGuide?.getAttribute('data-focus-column')).toBe(expectedColumn);
      expect(focusHeader?.className).toContain('is-focus-column');
      expect(focusHeader?.textContent).toContain('重点');
    },
  );

  it('highlights the lottery column header for lottery-driven precise focus', async () => {
    const rows = [
      buildMarket(0, {
        lotteryCandidate: true,
        lotteryReferenceAsk: 0.02,
        lotteryCurrentAsk: 0.05,
        lotteryLift: 0.03,
        lotteryConfirmationSource: 'trade_confirmed',
      }),
      buildMarket(1),
      buildMarket(2),
    ];
    const view = await renderView(rows, {}, {}, {
      focusAlert: buildAlert('alert-lottery-focus', {
        marketId: 'market-0',
        cityKey: 'city-0',
        ruleId: 'abnormal-lottery-threshold',
        messageKey: 'abnormal_lottery',
        messageParams: {
          actual: 0.03,
          threshold: 0.01,
          operator: '>',
        },
      }),
    });

    const preciseEntry = view.querySelector(
      '[data-testid="market-alert-open-precise"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      preciseEntry?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const precisionGuide = view.querySelector(
      '[data-testid="market-precision-guide"]',
    ) as HTMLElement | null;
    const lotteryHeader = view.querySelector(
      '[data-testid="market-precision-header-lottery"]',
    ) as HTMLTableCellElement | null;

    expect(precisionGuide).not.toBeNull();
    expect(lotteryHeader).not.toBeNull();
    expect(precisionGuide?.getAttribute('data-focus-column')).toBe('lottery');
    expect(lotteryHeader?.className).toContain('is-focus-column');
  });
});
