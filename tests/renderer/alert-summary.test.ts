import { describe, expect, it } from 'vitest';

import type { AlertEvent } from '../../src/renderer/types/contracts';
import { buildAlertSummaryDraft } from '../../src/renderer/utils/alert-summary';

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
  messageKey: 'spread_threshold',
  messageParams: {
    actual: 0.02,
    threshold: 0.01,
    operator: '>',
  },
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

describe('buildAlertSummaryDraft', () => {
  it('builds one reusable summary contract for object, trigger, and locator copy', () => {
    const summary = buildAlertSummaryDraft(buildAlert('1'));

    expect(summary.objectSummary).toContain('北京');
    expect(summary.objectSummary).toContain('market-1');
    expect(summary.triggerSummary).toContain('触发');
    expect(summary.primaryFact).not.toBeNull();
    expect(summary.visibleFacts.length).toBeGreaterThan(0);
    expect(summary.locatorTitle).toBe('market-1');
    expect(summary.locatorSubtitle).toContain('北京');
    expect(summary.locatorMeta).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'marketId', value: 'market-1' }),
        expect.objectContaining({ key: 'rule' }),
      ]),
    );
  });
});
