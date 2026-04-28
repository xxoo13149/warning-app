import { describe, expect, it } from 'vitest';

import type { AlertRule } from '../../src/renderer/types/contracts';
import {
  filterRuleDrafts,
  groupRuleDrafts,
  normalizeRuleDraft,
} from '../../src/renderer/utils/rules-settings';

const createRule = (overrides: Partial<AlertRule> = {}): AlertRule => ({
  id: overrides.id ?? 'rule-1',
  name: overrides.name ?? '价格提醒',
  metric: overrides.metric ?? 'price',
  operator: overrides.operator ?? 'crosses',
  threshold: overrides.threshold ?? 0.5,
  windowSec: overrides.windowSec ?? 120,
  cooldownSec: overrides.cooldownSec ?? 180,
  dedupeWindowSec: overrides.dedupeWindowSec ?? 90,
  bubbleWeight: overrides.bubbleWeight ?? 60,
  severity: overrides.severity ?? 'critical',
  enabled: overrides.enabled ?? true,
  soundProfileId: overrides.soundProfileId ?? '',
  isBuiltin: overrides.isBuiltin,
  builtinKey: overrides.builtinKey,
  scope: overrides.scope ?? {},
  quietHours: overrides.quietHours,
});

describe('rules settings severity unification', () => {
  it('normalizes all rule drafts to a single alert severity', () => {
    const normalizedCritical = normalizeRuleDraft(createRule({ severity: 'critical' }));
    const normalizedInfo = normalizeRuleDraft(createRule({ id: 'rule-2', severity: 'info' }));

    expect(normalizedCritical.severity).toBe('warning');
    expect(normalizedInfo.severity).toBe('warning');
  });

  it('collapses severity grouping into one alert group', () => {
    const grouped = groupRuleDrafts(
      [
        createRule({ id: 'rule-1', severity: 'critical' }),
        createRule({ id: 'rule-2', severity: 'info' }),
      ].map((rule) => normalizeRuleDraft(rule)),
      { by: 'severity' },
    );

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.label).toBe('告警');
    expect(grouped[0]?.count).toBe(2);
  });

  it('ignores legacy severity filters in the renderer rule list', () => {
    const rules = [
      createRule({ id: 'rule-1', severity: 'critical' }),
      createRule({ id: 'rule-2', severity: 'info' }),
    ].map((rule) => normalizeRuleDraft(rule));

    const filtered = filterRuleDrafts(rules, { severity: 'critical' });

    expect(filtered).toHaveLength(2);
  });
});
