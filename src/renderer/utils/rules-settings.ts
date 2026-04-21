import { formatBuiltinRuleName } from '../../shared/alert-display';
import type { AlertRule, MarketRow, OrderSide } from '../types/contracts';

export interface RuleScopeFilters {
  cityKey: string;
  eventDate: string;
  temperatureBand: string;
  side: '' | OrderSide;
}

export interface ScopeOption {
  value: string;
  label: string;
}

export interface RuleQuietHoursDraft {
  start: string;
  end: string;
}

export const PRIMARY_SCOPE_KEYS = ['cityKey', 'eventDate', 'temperatureBand', 'side'] as const;

export type PrimaryScopeKey = (typeof PRIMARY_SCOPE_KEYS)[number];

export const EMPTY_SCOPE_FILTERS: RuleScopeFilters = {
  cityKey: '',
  eventDate: '',
  temperatureBand: '',
  side: '',
};

export const DEFAULT_RULE_QUIET_HOURS: RuleQuietHoursDraft = {
  start: '',
  end: '',
};

const BUILTIN_RULE_DEFAULTS: Omit<AlertRule, 'soundProfileId'>[] = [
  {
    id: 'price-change-5m',
    name: formatBuiltinRuleName('price_change_5m', 'zh-CN') ?? '5m Move',
    isBuiltin: true,
    builtinKey: 'price_change_5m',
    metric: 'change5m',
    operator: '>',
    threshold: 5,
    windowSec: 300,
    cooldownSec: 300,
    dedupeWindowSec: 120,
    bubbleWeight: 55,
    severity: 'warning',
    enabled: true,
    scope: {},
  },
  {
    id: 'spread-threshold',
    name: formatBuiltinRuleName('spread_threshold', 'zh-CN') ?? 'Wide Spread',
    isBuiltin: true,
    builtinKey: 'spread_threshold',
    metric: 'spread',
    operator: '>',
    threshold: 0.05,
    windowSec: 60,
    cooldownSec: 180,
    dedupeWindowSec: 90,
    bubbleWeight: 70,
    severity: 'warning',
    enabled: true,
    scope: {},
  },
  {
    id: 'feed-stale',
    name: formatBuiltinRuleName('feed_stale', 'zh-CN') ?? 'Feed Stale',
    isBuiltin: true,
    builtinKey: 'feed_stale',
    metric: 'feed_stale',
    operator: '>',
    threshold: 90,
    windowSec: 90,
    cooldownSec: 120,
    dedupeWindowSec: 90,
    bubbleWeight: 95,
    severity: 'critical',
    enabled: true,
    scope: {},
  },
  {
    id: 'liquidity-kill',
    name: formatBuiltinRuleName('liquidity_kill', 'zh-CN') ?? 'Liquidity Kill',
    isBuiltin: true,
    builtinKey: 'liquidity_kill',
    metric: 'liquidity_kill',
    operator: '<=',
    threshold: 0.01,
    windowSec: 60,
    cooldownSec: 180,
    dedupeWindowSec: 90,
    bubbleWeight: 90,
    severity: 'critical',
    enabled: true,
    scope: {},
  },
];

const createRuleId = () =>
  `custom-rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const cleanText = (value: string | undefined) => value?.trim() ?? '';

const normalizeScope = (scope: AlertRule['scope']) => {
  const nextScope: AlertRule['scope'] = {};

  if (cleanText(scope?.cityKey)) {
    nextScope.cityKey = cleanText(scope?.cityKey);
  }
  if (cleanText(scope?.seriesSlug)) {
    nextScope.seriesSlug = cleanText(scope?.seriesSlug);
  }
  if (cleanText(scope?.eventDate)) {
    nextScope.eventDate = cleanText(scope?.eventDate);
  }
  if (cleanText(scope?.temperatureBand)) {
    nextScope.temperatureBand = cleanText(scope?.temperatureBand);
  }
  if (cleanText(scope?.marketId)) {
    nextScope.marketId = cleanText(scope?.marketId);
  }
  if (cleanText(scope?.tokenId)) {
    nextScope.tokenId = cleanText(scope?.tokenId);
  }
  if (scope?.side && scope.side !== 'BOTH') {
    nextScope.side = scope.side;
  }

  return nextScope;
};

export const normalizeRuleDraft = (rule: AlertRule): AlertRule => {
  const nextRule: AlertRule = {
    ...rule,
    name: cleanText(rule.name),
    threshold: Number.isFinite(rule.threshold) ? rule.threshold : 0,
    windowSec: Number.isFinite(rule.windowSec) ? Math.max(1, Math.trunc(rule.windowSec)) : 60,
    cooldownSec: Number.isFinite(rule.cooldownSec) ? Math.max(0, Math.trunc(rule.cooldownSec)) : 60,
    dedupeWindowSec: Number.isFinite(rule.dedupeWindowSec)
      ? Math.max(0, Math.trunc(rule.dedupeWindowSec))
      : 30,
    bubbleWeight: Number.isFinite(rule.bubbleWeight) ? Math.max(0, rule.bubbleWeight) : 60,
    soundProfileId: cleanText(rule.soundProfileId),
    scope: normalizeScope(rule.scope),
  };

  if (
    rule.quietHours &&
    Number.isFinite(rule.quietHours.startMinute) &&
    Number.isFinite(rule.quietHours.endMinute)
  ) {
    nextRule.quietHours = {
      startMinute: clampMinute(rule.quietHours.startMinute),
      endMinute: clampMinute(rule.quietHours.endMinute),
    };
  } else {
    delete nextRule.quietHours;
  }

  if (!nextRule.name) {
    nextRule.name =
      formatBuiltinRuleName(nextRule.builtinKey, 'zh-CN') ??
      nextRule.builtinKey ??
      nextRule.id;
  }

  return nextRule;
};

export const normalizeRuleDrafts = (rules: AlertRule[]) =>
  rules.map((rule) => normalizeRuleDraft(rule));

export const createBuiltinRuleTemplateMap = (defaultSoundProfileId = '') =>
  new Map(
    BUILTIN_RULE_DEFAULTS.map((rule) => [
      rule.id,
      normalizeRuleDraft({
        ...rule,
        soundProfileId: defaultSoundProfileId,
      }),
    ]),
  );

export const createCustomRule = (
  filters: RuleScopeFilters,
  defaultSoundProfileId = '',
): AlertRule =>
  normalizeRuleDraft({
    id: createRuleId(),
    name: 'Custom Rule',
    metric: 'price',
    operator: 'crosses',
    threshold: 0.5,
    windowSec: 120,
    cooldownSec: 180,
    dedupeWindowSec: 90,
    bubbleWeight: 60,
    severity: 'warning',
    enabled: true,
    soundProfileId: defaultSoundProfileId,
    scope: scopeFromFilters(filters),
  });

export const duplicateRule = (rule: AlertRule): AlertRule =>
  normalizeRuleDraft({
    ...rule,
    id: createRuleId(),
    name: `${rule.name || 'Rule'} Copy`,
    isBuiltin: false,
    builtinKey: undefined,
  });

export const scopeFromFilters = (filters: RuleScopeFilters): AlertRule['scope'] => {
  const scope: AlertRule['scope'] = {};

  if (cleanText(filters.cityKey)) {
    scope.cityKey = cleanText(filters.cityKey);
  }
  if (cleanText(filters.eventDate)) {
    scope.eventDate = cleanText(filters.eventDate);
  }
  if (cleanText(filters.temperatureBand)) {
    scope.temperatureBand = cleanText(filters.temperatureBand);
  }
  if (filters.side && filters.side !== 'BOTH') {
    scope.side = filters.side;
  }

  return scope;
};

export const filtersFromRule = (rule: Pick<AlertRule, 'scope'>): RuleScopeFilters => ({
  cityKey: cleanText(rule.scope?.cityKey),
  eventDate: cleanText(rule.scope?.eventDate),
  temperatureBand: cleanText(rule.scope?.temperatureBand),
  side: rule.scope?.side === 'YES' || rule.scope?.side === 'NO' ? rule.scope.side : '',
});

export const replaceRuleScopeFilters = (
  rule: AlertRule,
  filters: RuleScopeFilters,
): AlertRule => {
  const preservedScope: AlertRule['scope'] = {
    seriesSlug: cleanText(rule.scope?.seriesSlug) || undefined,
    marketId: cleanText(rule.scope?.marketId) || undefined,
    tokenId: cleanText(rule.scope?.tokenId) || undefined,
  };

  return normalizeRuleDraft({
    ...rule,
    scope: {
      ...preservedScope,
      ...scopeFromFilters(filters),
    },
  });
};

export const applyFiltersToRule = (rule: AlertRule, filters: RuleScopeFilters): AlertRule =>
  normalizeRuleDraft({
    ...rule,
    scope: {
      ...rule.scope,
      ...scopeFromFilters(filters),
    },
  });

export const buildScopeOptions = (
  marketRows: MarketRow[],
  rules: AlertRule[],
): {
  cities: ScopeOption[];
  dates: ScopeOption[];
  bands: ScopeOption[];
} => {
  const cityMap = new Map<string, string>();
  const dateSet = new Set<string>();
  const bandSet = new Set<string>();

  marketRows.forEach((row) => {
    if (cleanText(row.cityKey)) {
      cityMap.set(row.cityKey, row.cityName || row.cityKey);
    }
    if (cleanText(row.eventDate)) {
      dateSet.add(row.eventDate);
    }
    if (cleanText(row.temperatureBand)) {
      bandSet.add(row.temperatureBand);
    }
  });

  rules.forEach((rule) => {
    if (cleanText(rule.scope?.cityKey) && !cityMap.has(rule.scope.cityKey!)) {
      cityMap.set(rule.scope.cityKey!, rule.scope.cityKey!);
    }
    if (cleanText(rule.scope?.eventDate)) {
      dateSet.add(rule.scope.eventDate!);
    }
    if (cleanText(rule.scope?.temperatureBand)) {
      bandSet.add(rule.scope.temperatureBand!);
    }
  });

  return {
    cities: [...cityMap.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    dates: [...dateSet]
      .map((value) => ({ value, label: value }))
      .sort((left, right) => right.value.localeCompare(left.value)),
    bands: [...bandSet]
      .map((value) => ({ value, label: value }))
      .sort((left, right) => left.value.localeCompare(right.value)),
  };
};

export const ruleMatchesFilters = (
  rule: AlertRule,
  filters: RuleScopeFilters,
  { builtinAlwaysVisible = false }: { builtinAlwaysVisible?: boolean } = {},
) => {
  if (builtinAlwaysVisible && rule.isBuiltin) {
    return true;
  }

  if (cleanText(filters.cityKey) && rule.scope?.cityKey !== cleanText(filters.cityKey)) {
    return false;
  }
  if (cleanText(filters.eventDate) && rule.scope?.eventDate !== cleanText(filters.eventDate)) {
    return false;
  }
  if (
    cleanText(filters.temperatureBand) &&
    rule.scope?.temperatureBand !== cleanText(filters.temperatureBand)
  ) {
    return false;
  }
  if (filters.side && filters.side !== 'BOTH' && rule.scope?.side !== filters.side) {
    return false;
  }

  return true;
};

export const buildRuleScopeSummary = (rule: AlertRule) => {
  const parts: string[] = [];
  if (rule.scope?.cityKey) {
    parts.push(rule.scope.cityKey);
  }
  if (rule.scope?.eventDate) {
    parts.push(rule.scope.eventDate);
  }
  if (rule.scope?.temperatureBand) {
    parts.push(rule.scope.temperatureBand);
  }
  if (rule.scope?.side && rule.scope.side !== 'BOTH') {
    parts.push(rule.scope.side);
  }
  if (rule.scope?.seriesSlug) {
    parts.push(`series:${rule.scope.seriesSlug}`);
  }
  if (rule.scope?.marketId) {
    parts.push(`market:${rule.scope.marketId}`);
  }
  if (rule.scope?.tokenId) {
    parts.push(`token:${rule.scope.tokenId}`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'Global scope';
};

export const quietHoursToDraft = (
  quietHours: AlertRule['quietHours'],
): RuleQuietHoursDraft => {
  if (!quietHours) {
    return { ...DEFAULT_RULE_QUIET_HOURS };
  }

  return {
    start: minuteToTime(quietHours.startMinute),
    end: minuteToTime(quietHours.endMinute),
  };
};

export const quietHoursDraftToValue = (
  draft: RuleQuietHoursDraft,
): AlertRule['quietHours'] | undefined => {
  if (!draft.start || !draft.end) {
    return undefined;
  }

  return {
    startMinute: timeToMinute(draft.start),
    endMinute: timeToMinute(draft.end),
  };
};

export const quietHoursSummary = (quietHours: AlertRule['quietHours']) => {
  if (!quietHours) {
    return 'Use global quiet hours';
  }
  return `${minuteToTime(quietHours.startMinute)} - ${minuteToTime(quietHours.endMinute)}`;
};

export const serializeRuleDrafts = (rules: AlertRule[]) =>
  JSON.stringify(
    normalizeRuleDrafts(rules).map((rule) => ({
      ...rule,
      scope: {
        cityKey: rule.scope?.cityKey ?? '',
        eventDate: rule.scope?.eventDate ?? '',
        temperatureBand: rule.scope?.temperatureBand ?? '',
        side: rule.scope?.side ?? '',
        seriesSlug: rule.scope?.seriesSlug ?? '',
        marketId: rule.scope?.marketId ?? '',
        tokenId: rule.scope?.tokenId ?? '',
      },
      quietHours: rule.quietHours
        ? {
            startMinute: clampMinute(rule.quietHours.startMinute),
            endMinute: clampMinute(rule.quietHours.endMinute),
          }
        : null,
    })),
  );

export const minuteToTime = (minute: number) => {
  const value = clampMinute(minute);
  const hours = Math.floor(value / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (value % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
};

export const timeToMinute = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return 0;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return clampMinute(hours * 60 + minutes);
};

export const clampMinute = (value: number) =>
  Math.max(0, Math.min(1439, Math.trunc(value)));
