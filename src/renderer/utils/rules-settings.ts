import { formatBuiltinRuleName } from '../../shared/alert-display';
import type { AlertRule, MarketRow, OrderSide } from '../types/contracts';

export interface RuleScopeFilters {
  cityKey: string;
  eventDate: string;
  temperatureBand: string;
  side: '' | OrderSide;
  marketId: string;
}

export interface ScopeOption {
  value: string;
  label: string;
  count?: number;
}

export interface MarketScopeOption extends ScopeOption {
  marketId: string;
  cityKey: string;
  cityName: string;
  eventDate: string;
  temperatureBand: string;
  side: OrderSide;
  scope: AlertRule['scope'];
}

export interface RuleQuietHoursDraft {
  start: string;
  end: string;
}

export interface RuleScopeSummaryPart {
  key: keyof AlertRule['scope'];
  label: string;
  value: string;
}

export interface RuleDraftTemplate {
  key: string;
  label: string;
  description: string;
  rule: AlertRule;
}

export interface RuleEditorScopeOptions {
  cities: ScopeOption[];
  dates: ScopeOption[];
  bands: ScopeOption[];
  sides: ScopeOption[];
  markets: MarketScopeOption[];
}

export interface RuleDraftFilter {
  query?: string;
  source?: 'all' | 'builtin' | 'custom';
  enabled?: boolean;
  metric?: AlertRule['metric'] | '';
  severity?: AlertRule['severity'] | '';
  soundProfileId?: string;
  scope?: Partial<RuleScopeFilters>;
  builtinAlwaysVisible?: boolean;
}

export type RuleDraftSortKey =
  | 'source'
  | 'enabled'
  | 'name'
  | 'metric'
  | 'severity'
  | 'threshold'
  | 'windowSec'
  | 'cooldownSec'
  | 'dedupeWindowSec'
  | 'bubbleWeight'
  | 'scope';

export type RuleDraftSortDirection = 'asc' | 'desc';

export interface RuleDraftSortOptions {
  key: RuleDraftSortKey;
  direction?: RuleDraftSortDirection;
  marketRows?: MarketRow[];
}

export type RuleDraftGroupKey = 'source' | 'enabled' | 'severity' | 'metric' | 'scope';

export interface RuleDraftGroup {
  key: string;
  label: string;
  rules: AlertRule[];
  count: number;
}

export interface GroupRuleDraftsOptions {
  by?: RuleDraftGroupKey;
  sort?: RuleDraftSortOptions;
  marketRows?: MarketRow[];
}

export interface BuildRuleDraftListOptions {
  filter?: RuleDraftFilter;
  sort?: RuleDraftSortOptions;
  groupBy?: RuleDraftGroupKey;
  marketRows?: MarketRow[];
}

export interface CreateRuleDraftOptions {
  filters?: RuleScopeFilters;
  marketRow?: MarketRow;
  defaultSoundProfileId?: string;
  name?: string;
  overrides?: Partial<
    Omit<
      AlertRule,
      'id' | 'name' | 'isBuiltin' | 'builtinKey' | 'soundProfileId' | 'scope'
    >
  > & {
    scope?: Partial<AlertRule['scope']>;
  };
}

export const PRIMARY_SCOPE_KEYS = ['cityKey', 'eventDate', 'temperatureBand', 'side'] as const;

export type PrimaryScopeKey = (typeof PRIMARY_SCOPE_KEYS)[number];

export const EMPTY_SCOPE_FILTERS: RuleScopeFilters = {
  cityKey: '',
  eventDate: '',
  temperatureBand: '',
  side: '',
  marketId: '',
};

export const DEFAULT_RULE_QUIET_HOURS: RuleQuietHoursDraft = {
  start: '',
  end: '',
};

export const RULE_SIDE_FILTER_OPTIONS: ScopeOption[] = [
  { value: '', label: '全部方向' },
  { value: 'YES', label: '是' },
  { value: 'NO', label: '否' },
];

export const DEFAULT_RULE_DRAFT_SORT: RuleDraftSortOptions = {
  key: 'source',
  direction: 'asc',
};

const RULE_SCOPE_EMPTY_LABEL = '未限定范围，监控全部市场';
const RULE_SCOPE_GLOBAL_QUIET_HOURS_LABEL = '使用全局静音时段';
const DEFAULT_CUSTOM_RULE_NAME = '新建规则';
const DEFAULT_RULE_COPY_SUFFIX = '副本';
const DEFAULT_BUILTIN_RULE_GROUP_LABEL = '系统规则';
const DEFAULT_CUSTOM_RULE_GROUP_LABEL = '自定义规则';
const DEFAULT_ENABLED_RULE_GROUP_LABEL = '已启用';
const DEFAULT_DISABLED_RULE_GROUP_LABEL = '已停用';
const DEFAULT_SCOPED_RULE_GROUP_LABEL = '指定范围';
const DEFAULT_GLOBAL_RULE_GROUP_LABEL = '全局规则';
const DEFAULT_MARKET_RULE_GROUP_LABEL = '指定市场';

const BUILTIN_RULE_NAME_FALLBACKS: Record<NonNullable<AlertRule['builtinKey']>, string> = {
  price_change_5m: '5 分钟价格异动',
  spread_threshold: '买卖价差过宽',
  feed_stale: '数据停更提醒',
  liquidity_kill: '流动性骤降',
};

export const RULE_METRIC_LABELS: Record<AlertRule['metric'], string> = {
  price: '价格',
  change5m: '5 分钟涨跌幅',
  spread: '买卖价差',
  liquidity_kill: '流动性骤降',
  bidask_gap: '买卖盘缺口',
  new_market: '新市场上线',
  resolved: '市场已结算',
  feed_stale: '数据停更',
};

export const RULE_SEVERITY_LABELS: Record<AlertRule['severity'], string> = {
  critical: '紧急',
  warning: '预警',
  info: '提示',
};

export const RULE_OPERATOR_LABELS: Record<AlertRule['operator'], string> = {
  '>': '高于',
  '<': '低于',
  '>=': '不低于',
  '<=': '不高于',
  crosses: '达到或穿过',
};

const RULE_SEVERITY_ORDER: Record<AlertRule['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const RULE_TEMPLATE_DEFINITIONS = [
  {
    key: 'price-threshold',
    label: '价格到位提醒',
    description: '当价格达到或穿过你设定的价位时提醒。',
    overrides: {
      metric: 'price',
      operator: 'crosses',
      threshold: 0.5,
      windowSec: 120,
      cooldownSec: 180,
      dedupeWindowSec: 90,
      bubbleWeight: 60,
      severity: 'warning',
    },
  },
  {
    key: 'price-change-5m',
    label: '5 分钟快速波动',
    description: '最近 5 分钟涨跌幅超过设定比例时提醒。',
    overrides: {
      metric: 'change5m',
      operator: '>',
      threshold: 5,
      windowSec: 300,
      cooldownSec: 300,
      dedupeWindowSec: 120,
      bubbleWeight: 55,
      severity: 'warning',
    },
  },
  {
    key: 'spread-threshold',
    label: '买卖价差过宽',
    description: '买一和卖一之间的差距明显拉大时提醒。',
    overrides: {
      metric: 'spread',
      operator: '>',
      threshold: 0.05,
      windowSec: 60,
      cooldownSec: 180,
      dedupeWindowSec: 90,
      bubbleWeight: 70,
      severity: 'warning',
    },
  },
  {
    key: 'feed-stale',
    label: '数据停更提醒',
    description: '实时行情长时间没有更新时提醒。',
    overrides: {
      metric: 'feed_stale',
      operator: '>',
      threshold: 90,
      windowSec: 90,
      cooldownSec: 120,
      dedupeWindowSec: 90,
      bubbleWeight: 95,
      severity: 'critical',
    },
  },
] as const;

const formatBuiltinRuleNameZh = (builtinKey: AlertRule['builtinKey']) => {
  if (!builtinKey) {
    return null;
  }
  return formatBuiltinRuleName(builtinKey, 'zh-CN') ?? BUILTIN_RULE_NAME_FALLBACKS[builtinKey];
};

const BUILTIN_RULE_DEFAULTS: Omit<AlertRule, 'soundProfileId'>[] = [
  {
    id: 'price-change-5m',
    name: formatBuiltinRuleNameZh('price_change_5m') ?? BUILTIN_RULE_NAME_FALLBACKS.price_change_5m,
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
    name: formatBuiltinRuleNameZh('spread_threshold') ?? BUILTIN_RULE_NAME_FALLBACKS.spread_threshold,
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
    name: formatBuiltinRuleNameZh('feed_stale') ?? BUILTIN_RULE_NAME_FALLBACKS.feed_stale,
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
    name: formatBuiltinRuleNameZh('liquidity_kill') ?? BUILTIN_RULE_NAME_FALLBACKS.liquidity_kill,
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

const shortIdentifier = (value: string, visibleLength = 12) => {
  const normalizedValue = cleanText(value);
  return normalizedValue.length > visibleLength
    ? `${normalizedValue.slice(0, visibleLength)}...`
    : normalizedValue;
};

const formatRuleSideLabel = (side: OrderSide) => {
  switch (side) {
    case 'YES':
      return '是';
    case 'NO':
      return '否';
    default:
      return '双边';
  }
};

const formatTemperatureBandLabel = (value: string | undefined) => {
  const normalizedValue = cleanText(value);
  if (!normalizedValue) {
    return '';
  }

  return normalizedValue
    .replace(/(\d+(?:\.\d+)?)\s*[°º]?\s*[cC]\b/g, '$1℃')
    .replace(/\s+to\s+/gi, ' 至 ')
    .replace(/\s*-\s*/g, ' 至 ')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

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
      formatBuiltinRuleNameZh(nextRule.builtinKey) ??
      (nextRule.isBuiltin ? DEFAULT_BUILTIN_RULE_GROUP_LABEL : DEFAULT_CUSTOM_RULE_NAME);
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

export const createRuleDraftTemplate = ({
  filters = EMPTY_SCOPE_FILTERS,
  marketRow,
  defaultSoundProfileId = '',
  name = DEFAULT_CUSTOM_RULE_NAME,
  overrides,
}: CreateRuleDraftOptions = {}): AlertRule => {
  const baseScope = marketRow ? scopeFromMarketRow(marketRow) : scopeFromFilters(filters);
  const nextScope = normalizeScope({
    ...baseScope,
    ...overrides?.scope,
  });

  return normalizeRuleDraft({
    id: createRuleId(),
    name,
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
    ...overrides,
    scope: nextScope,
  });
};

export const createRuleDraftTemplates = (
  options: Omit<CreateRuleDraftOptions, 'name' | 'overrides'> = {},
): RuleDraftTemplate[] =>
  RULE_TEMPLATE_DEFINITIONS.map((template) => ({
    key: template.key,
    label: template.label,
    description: template.description,
    rule: createRuleDraftTemplate({
      ...options,
      name: template.label,
      overrides: template.overrides,
    }),
  }));

export const createCustomRule = (
  filters: RuleScopeFilters,
  defaultSoundProfileId = '',
): AlertRule =>
  createRuleDraftTemplate({
    filters,
    defaultSoundProfileId,
  });

export const formatRuleMetricLabel = (metric: AlertRule['metric']) => RULE_METRIC_LABELS[metric];

export const formatRuleSeverityLabel = (severity: AlertRule['severity']) =>
  RULE_SEVERITY_LABELS[severity];

export const formatRuleOperatorLabel = (operator: AlertRule['operator']) =>
  RULE_OPERATOR_LABELS[operator];

export const formatRuleSourceLabel = (rule: AlertRule) =>
  rule.isBuiltin ? DEFAULT_BUILTIN_RULE_GROUP_LABEL : DEFAULT_CUSTOM_RULE_GROUP_LABEL;

export const formatRuleDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0 秒';
  }

  if (seconds >= 3600 && seconds % 3600 === 0) {
    return `${seconds / 3600} 小时`;
  }

  if (seconds >= 60 && seconds % 60 === 0) {
    return `${seconds / 60} 分钟`;
  }

  return `${seconds} 秒`;
};

const formatRuleThresholdValue = (rule: AlertRule) => {
  if (!Number.isFinite(rule.threshold)) {
    return '--';
  }

  switch (rule.metric) {
    case 'price':
    case 'liquidity_kill':
      return `${Math.round(rule.threshold * 100)} 分`;
    case 'spread':
      return `${(rule.threshold * 100).toFixed(1).replace(/\.0$/, '')}%`;
    case 'change5m':
      return `${rule.threshold}%`;
    case 'feed_stale':
      return formatRuleDuration(rule.threshold);
    default:
      return String(rule.threshold);
  }
};

export const buildRuleConditionSummary = (rule: AlertRule) => {
  const operatorLabel = formatRuleOperatorLabel(rule.operator);
  const thresholdLabel = formatRuleThresholdValue(rule);

  switch (rule.metric) {
    case 'price':
      return `价格${operatorLabel}${thresholdLabel}时提醒`;
    case 'change5m':
      return `${formatRuleDuration(rule.windowSec)}内价格变化${operatorLabel}${thresholdLabel}时提醒`;
    case 'spread':
      return `买卖价差${operatorLabel}${thresholdLabel}时提醒`;
    case 'liquidity_kill':
      return `流动性指标${operatorLabel}${thresholdLabel}时提醒`;
    case 'bidask_gap':
      return `买卖盘缺口${operatorLabel}${thresholdLabel}时提醒`;
    case 'new_market':
      return `新市场条件${operatorLabel}${thresholdLabel}时提醒`;
    case 'resolved':
      return `结算状态${operatorLabel}${thresholdLabel}时提醒`;
    case 'feed_stale':
      if (rule.operator === '>' || rule.operator === '>=') {
        return `数据连续 ${thresholdLabel} 未更新时提醒`;
      }
      return `数据停更时长${operatorLabel}${thresholdLabel}时提醒`;
    default:
      return `${formatRuleMetricLabel(rule.metric)}${operatorLabel}${thresholdLabel}时提醒`;
  }
};

const buildDuplicateRuleName = (rule: AlertRule) => {
  return `${resolveRuleDisplayName(rule)} ${DEFAULT_RULE_COPY_SUFFIX}`;
};

export const duplicateRuleDraft = (
  rule: AlertRule,
  options: { name?: string; soundProfileId?: string; preserveEnabled?: boolean } = {},
): AlertRule =>
  normalizeRuleDraft({
    ...rule,
    id: createRuleId(),
    name: cleanText(options.name) || buildDuplicateRuleName(rule),
    enabled: options.preserveEnabled ?? rule.enabled,
    soundProfileId: cleanText(options.soundProfileId) || rule.soundProfileId,
    isBuiltin: false,
    builtinKey: undefined,
  });

export const duplicateRule = (rule: AlertRule): AlertRule => duplicateRuleDraft(rule);

export const scopeFromFilters = (filters: RuleScopeFilters): AlertRule['scope'] => {
  const scope: AlertRule['scope'] = {};

  if (cleanText(filters.marketId)) {
    scope.marketId = cleanText(filters.marketId);
  }
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

export const scopeFromMarketRow = (marketRow: MarketRow): AlertRule['scope'] =>
  normalizeScope({
    cityKey: marketRow.cityKey,
    eventDate: marketRow.eventDate,
    temperatureBand: marketRow.temperatureBand,
    marketId: marketRow.marketId,
    side: marketRow.side === 'YES' || marketRow.side === 'NO' ? marketRow.side : undefined,
  });

export const filtersFromRule = (rule: Pick<AlertRule, 'scope'>): RuleScopeFilters => ({
  cityKey: cleanText(rule.scope?.cityKey),
  eventDate: cleanText(rule.scope?.eventDate),
  temperatureBand: cleanText(rule.scope?.temperatureBand),
  side: rule.scope?.side === 'YES' || rule.scope?.side === 'NO' ? rule.scope.side : '',
  marketId: cleanText(rule.scope?.marketId),
});

export const replaceRuleScopeFilters = (
  rule: AlertRule,
  filters: RuleScopeFilters,
): AlertRule => {
  return normalizeRuleDraft({
    ...rule,
    scope: scopeFromFilters(filters),
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

const buildMarketOptionLabel = (marketRow: Pick<
  MarketRow,
  'cityKey' | 'cityName' | 'eventDate' | 'temperatureBand' | 'side'
>) =>
  [
    cleanText(marketRow.cityName) || cleanText(marketRow.cityKey),
    cleanText(marketRow.eventDate),
    formatTemperatureBandLabel(marketRow.temperatureBand),
    formatRuleSideLabel(marketRow.side),
  ]
    .filter(Boolean)
    .join('，');

const addScopeOption = (
  map: Map<string, { label: string; count: number }>,
  value: string | undefined,
  label: string,
  countDelta = 0,
) => {
  const normalizedValue = cleanText(value);
  const normalizedLabel = cleanText(label);
  if (!normalizedValue) {
    return;
  }

  const current = map.get(normalizedValue);
  const nextLabel =
    normalizedLabel && (!current?.label || current.label === normalizedValue)
      ? normalizedLabel
      : current?.label || normalizedValue;
  map.set(normalizedValue, {
    label: nextLabel,
    count: Math.max(0, (current?.count ?? 0) + countDelta),
  });
};

const toScopeOptions = (
  map: Map<string, { label: string; count: number }>,
  compare: (
    left: ScopeOption,
    right: ScopeOption,
  ) => number = (left, right) => left.label.localeCompare(right.label, 'zh-CN'),
): ScopeOption[] =>
  [...map.entries()]
    .map(([value, meta]) => ({
      value,
      label: meta.label,
      count: meta.count,
    }))
    .sort(compare);

const buildOrphanMarketOption = (rule: AlertRule): MarketScopeOption | null => {
  const marketId = cleanText(rule.scope?.marketId);
  if (!marketId) {
    return null;
  }

  const cityKey = cleanText(rule.scope?.cityKey);
  const cityName = cityKey || '未命名城市';
  const eventDate = cleanText(rule.scope?.eventDate);
  const temperatureBand = cleanText(rule.scope?.temperatureBand);
  const side = rule.scope?.side ?? 'BOTH';

  return {
    value: marketId,
    label:
      buildMarketOptionLabel({
        cityKey,
        cityName,
        eventDate,
        temperatureBand,
        side,
      }) || `指定市场（${shortIdentifier(marketId)}）`,
    count: 0,
    marketId,
    cityKey,
    cityName,
    eventDate,
    temperatureBand,
    side,
    scope: normalizeScope({
      ...rule.scope,
      marketId,
    }),
  };
};

export const buildRuleEditorScopeOptions = (
  marketRows: MarketRow[],
  rules: AlertRule[] = [],
): RuleEditorScopeOptions => {
  const cityMap = new Map<string, { label: string; count: number }>();
  const dateMap = new Map<string, { label: string; count: number }>();
  const bandMap = new Map<string, { label: string; count: number }>();
  const sideMap = new Map<string, { label: string; count: number }>(
    RULE_SIDE_FILTER_OPTIONS.filter((option) => option.value).map((option) => [
      option.value,
      { label: option.label, count: 0 },
    ]),
  );
  const marketMap = new Map<string, MarketScopeOption>();

  marketRows.forEach((row) => {
    addScopeOption(cityMap, row.cityKey, cleanText(row.cityName) || row.cityKey, 1);
    addScopeOption(dateMap, row.eventDate, row.eventDate, 1);
    addScopeOption(bandMap, row.temperatureBand, formatTemperatureBandLabel(row.temperatureBand), 1);
    if (row.side === 'YES' || row.side === 'NO') {
      addScopeOption(sideMap, row.side, formatRuleSideLabel(row.side), 1);
    }

    marketMap.set(row.marketId, {
      value: row.marketId,
      label: buildMarketOptionLabel(row),
      count: 1,
      marketId: row.marketId,
      cityKey: row.cityKey,
      cityName: row.cityName,
      eventDate: row.eventDate,
      temperatureBand: row.temperatureBand,
      side: row.side,
      scope: scopeFromMarketRow(row),
    });
  });

  rules.forEach((rule) => {
    addScopeOption(cityMap, rule.scope?.cityKey, rule.scope?.cityKey ?? '', 0);
    addScopeOption(dateMap, rule.scope?.eventDate, rule.scope?.eventDate ?? '', 0);
    addScopeOption(
      bandMap,
      rule.scope?.temperatureBand,
      formatTemperatureBandLabel(rule.scope?.temperatureBand),
      0,
    );
    if (rule.scope?.side === 'YES' || rule.scope?.side === 'NO') {
      addScopeOption(sideMap, rule.scope.side, formatRuleSideLabel(rule.scope.side), 0);
    }

    const orphanOption = buildOrphanMarketOption(rule);
    if (orphanOption && !marketMap.has(orphanOption.marketId)) {
      marketMap.set(orphanOption.marketId, orphanOption);
    }
  });

  return {
    cities: toScopeOptions(cityMap),
    dates: toScopeOptions(dateMap, (left, right) =>
      right.value.localeCompare(left.value, 'zh-CN'),
    ),
    bands: toScopeOptions(bandMap, (left, right) =>
      left.value.localeCompare(right.value, 'zh-CN'),
    ),
    sides: [
      RULE_SIDE_FILTER_OPTIONS[0],
      ...toScopeOptions(sideMap, (left, right) => left.value.localeCompare(right.value, 'zh-CN')),
    ],
    markets: [...marketMap.values()].sort((left, right) => {
      if (left.eventDate !== right.eventDate) {
        return right.eventDate.localeCompare(left.eventDate, 'zh-CN');
      }
      if (left.cityName !== right.cityName) {
        return left.cityName.localeCompare(right.cityName, 'zh-CN');
      }
      return left.temperatureBand.localeCompare(right.temperatureBand, 'zh-CN');
    }),
  };
};

export const buildScopeOptions = (
  marketRows: MarketRow[],
  rules: AlertRule[],
): {
  cities: ScopeOption[];
  dates: ScopeOption[];
  bands: ScopeOption[];
} => {
  const scopeOptions = buildRuleEditorScopeOptions(marketRows, rules);
  return {
    cities: scopeOptions.cities,
    dates: scopeOptions.dates,
    bands: scopeOptions.bands,
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
  if (cleanText(filters.marketId) && rule.scope?.marketId !== cleanText(filters.marketId)) {
    return false;
  }

  return true;
};

const buildScopeLabelMaps = (marketRows: MarketRow[]) => {
  const cityLabels = new Map<string, string>();
  const marketLabels = new Map<string, string>();

  marketRows.forEach((row) => {
    if (cleanText(row.cityKey)) {
      cityLabels.set(row.cityKey, cleanText(row.cityName) || row.cityKey);
    }
    if (cleanText(row.marketId)) {
      marketLabels.set(row.marketId, buildMarketOptionLabel(row));
    }
  });

  return { cityLabels, marketLabels };
};

export const buildRuleScopeSummaryParts = (
  rule: AlertRule,
  marketRows: MarketRow[] = [],
): RuleScopeSummaryPart[] => {
  const parts: RuleScopeSummaryPart[] = [];
  const { cityLabels, marketLabels } = buildScopeLabelMaps(marketRows);
  const hasPrimaryScope =
    cleanText(rule.scope?.cityKey) ||
    cleanText(rule.scope?.eventDate) ||
    cleanText(rule.scope?.temperatureBand) ||
    (rule.scope?.side && rule.scope.side !== 'BOTH');

  if (cleanText(rule.scope?.cityKey)) {
    const cityKey = cleanText(rule.scope?.cityKey);
    parts.push({
      key: 'cityKey',
      label: '城市',
      value: cityLabels.get(cityKey) ?? cityKey,
    });
  }
  if (cleanText(rule.scope?.eventDate)) {
    parts.push({
      key: 'eventDate',
      label: '日期',
      value: cleanText(rule.scope?.eventDate),
    });
  }
  if (cleanText(rule.scope?.temperatureBand)) {
    parts.push({
      key: 'temperatureBand',
      label: '温度区间',
      value: formatTemperatureBandLabel(rule.scope?.temperatureBand),
    });
  }
  if (rule.scope?.side && rule.scope.side !== 'BOTH') {
    parts.push({
      key: 'side',
      label: '方向',
      value: formatRuleSideLabel(rule.scope.side),
    });
  }
  if (cleanText(rule.scope?.seriesSlug)) {
    parts.push({
      key: 'seriesSlug',
      label: '市场系列',
      value: shortIdentifier(cleanText(rule.scope?.seriesSlug), 16),
    });
  }
  if (cleanText(rule.scope?.marketId)) {
    const marketId = cleanText(rule.scope?.marketId);
    parts.push({
      key: 'marketId',
      label: '市场',
      value: hasPrimaryScope
        ? '已指定单一市场'
        : marketLabels.get(marketId) ?? '已指定市场',
    });
  }
  if (cleanText(rule.scope?.tokenId)) {
    parts.push({
      key: 'tokenId',
      label: '合约',
      value: '已指定单个合约',
    });
  }

  return parts;
};

export const buildRuleScopeSummary = (rule: AlertRule, marketRows: MarketRow[] = []) => {
  const parts = buildRuleScopeSummaryParts(rule, marketRows);
  return parts.length > 0
    ? `仅监控 ${parts.map((part) => `${part.label}：${part.value}`).join('，')}`
    : RULE_SCOPE_EMPTY_LABEL;
};

const resolveRuleDisplayName = (rule: AlertRule) =>
  cleanText(rule.name) ||
  formatBuiltinRuleNameZh(rule.builtinKey) ||
  (rule.isBuiltin ? DEFAULT_BUILTIN_RULE_GROUP_LABEL : DEFAULT_CUSTOM_RULE_NAME);

const buildRuleSearchText = (rule: AlertRule, marketRows: MarketRow[] = []) =>
  [
    resolveRuleDisplayName(rule),
    formatBuiltinRuleNameZh(rule.builtinKey) ?? '',
    RULE_METRIC_LABELS[rule.metric],
    RULE_SEVERITY_LABELS[rule.severity],
    buildRuleScopeSummary(rule, marketRows),
    cleanText(rule.scope?.cityKey),
    cleanText(rule.scope?.seriesSlug),
    cleanText(rule.scope?.eventDate),
    cleanText(rule.scope?.temperatureBand),
    cleanText(rule.scope?.marketId),
    cleanText(rule.scope?.tokenId),
    cleanText(rule.soundProfileId),
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('zh-CN');

const toRuleScopeFilters = (scope?: Partial<RuleScopeFilters>): RuleScopeFilters => ({
  cityKey: cleanText(scope?.cityKey),
  eventDate: cleanText(scope?.eventDate),
  temperatureBand: cleanText(scope?.temperatureBand),
  side: scope?.side === 'YES' || scope?.side === 'NO' ? scope.side : '',
  marketId: cleanText(scope?.marketId),
});

const compareText = (left: string, right: string) => left.localeCompare(right, 'zh-CN');

const compareRuleValues = (
  left: AlertRule,
  right: AlertRule,
  key: RuleDraftSortKey,
  marketRows: MarketRow[] = [],
) => {
  switch (key) {
    case 'source':
      if (Boolean(left.isBuiltin) === Boolean(right.isBuiltin)) {
        return 0;
      }
      return left.isBuiltin ? -1 : 1;
    case 'enabled':
      if (left.enabled === right.enabled) {
        return 0;
      }
      return left.enabled ? -1 : 1;
    case 'name':
      return compareText(resolveRuleDisplayName(left), resolveRuleDisplayName(right));
    case 'metric':
      return compareText(RULE_METRIC_LABELS[left.metric], RULE_METRIC_LABELS[right.metric]);
    case 'severity':
      return RULE_SEVERITY_ORDER[left.severity] - RULE_SEVERITY_ORDER[right.severity];
    case 'threshold':
      return left.threshold - right.threshold;
    case 'windowSec':
      return left.windowSec - right.windowSec;
    case 'cooldownSec':
      return left.cooldownSec - right.cooldownSec;
    case 'dedupeWindowSec':
      return left.dedupeWindowSec - right.dedupeWindowSec;
    case 'bubbleWeight':
      return left.bubbleWeight - right.bubbleWeight;
    case 'scope':
      return compareText(
        buildRuleScopeSummary(left, marketRows),
        buildRuleScopeSummary(right, marketRows),
      );
    default:
      return 0;
  }
};

const buildRuleScopeGroupMeta = (rule: AlertRule) => {
  if (cleanText(rule.scope?.marketId) || cleanText(rule.scope?.tokenId)) {
    return { key: 'market', label: DEFAULT_MARKET_RULE_GROUP_LABEL };
  }

  return buildRuleScopeSummaryParts(rule).length > 0
    ? { key: 'scoped', label: DEFAULT_SCOPED_RULE_GROUP_LABEL }
    : { key: 'global', label: DEFAULT_GLOBAL_RULE_GROUP_LABEL };
};

const RULE_GROUP_ORDER: Record<RuleDraftGroupKey, readonly string[]> = {
  source: ['builtin', 'custom'],
  enabled: ['enabled', 'disabled'],
  severity: ['critical', 'warning', 'info'],
  metric: [
    'price',
    'change5m',
    'spread',
    'liquidity_kill',
    'bidask_gap',
    'new_market',
    'resolved',
    'feed_stale',
  ],
  scope: ['market', 'scoped', 'global'],
};

const resolveRuleGroup = (
  rule: AlertRule,
  by: RuleDraftGroupKey,
): Pick<RuleDraftGroup, 'key' | 'label'> => {
  switch (by) {
    case 'enabled':
      return rule.enabled
        ? { key: 'enabled', label: DEFAULT_ENABLED_RULE_GROUP_LABEL }
        : { key: 'disabled', label: DEFAULT_DISABLED_RULE_GROUP_LABEL };
    case 'severity':
      return { key: rule.severity, label: RULE_SEVERITY_LABELS[rule.severity] };
    case 'metric':
      return { key: rule.metric, label: RULE_METRIC_LABELS[rule.metric] };
    case 'scope':
      return buildRuleScopeGroupMeta(rule);
    case 'source':
    default:
      return rule.isBuiltin
        ? { key: 'builtin', label: DEFAULT_BUILTIN_RULE_GROUP_LABEL }
        : { key: 'custom', label: DEFAULT_CUSTOM_RULE_GROUP_LABEL };
  }
};

export const filterRuleDrafts = (
  rules: AlertRule[],
  filter: RuleDraftFilter = {},
  marketRows: MarketRow[] = [],
) => {
  const query = cleanText(filter.query).toLocaleLowerCase('zh-CN');
  const scopeFilters = toRuleScopeFilters(filter.scope);
  const hasScopeFilter =
    scopeFilters.cityKey ||
    scopeFilters.eventDate ||
    scopeFilters.temperatureBand ||
    scopeFilters.side ||
    scopeFilters.marketId ||
    filter.builtinAlwaysVisible;

  return rules.filter((rule) => {
    if (filter.source === 'builtin' && !rule.isBuiltin) {
      return false;
    }
    if (filter.source === 'custom' && rule.isBuiltin) {
      return false;
    }
    if (typeof filter.enabled === 'boolean' && rule.enabled !== filter.enabled) {
      return false;
    }
    if (filter.metric && rule.metric !== filter.metric) {
      return false;
    }
    if (filter.severity && rule.severity !== filter.severity) {
      return false;
    }
    if (cleanText(filter.soundProfileId) && rule.soundProfileId !== cleanText(filter.soundProfileId)) {
      return false;
    }
    if (
      hasScopeFilter &&
      !ruleMatchesFilters(rule, scopeFilters, {
        builtinAlwaysVisible: Boolean(filter.builtinAlwaysVisible),
      })
    ) {
      return false;
    }
    if (query && !buildRuleSearchText(rule, marketRows).includes(query)) {
      return false;
    }

    return true;
  });
};

export const sortRuleDrafts = (
  rules: AlertRule[],
  options: RuleDraftSortOptions = DEFAULT_RULE_DRAFT_SORT,
): AlertRule[] => {
  const direction = options.direction === 'desc' ? -1 : 1;
  const marketRows = options.marketRows ?? [];

  return [...rules].sort((left, right) => {
    const primary = compareRuleValues(left, right, options.key, marketRows) * direction;
    if (primary !== 0) {
      return primary;
    }

    const byName = compareText(resolveRuleDisplayName(left), resolveRuleDisplayName(right));
    if (byName !== 0) {
      return byName;
    }

    return compareText(left.id, right.id);
  });
};

export const groupRuleDrafts = (
  rules: AlertRule[],
  options: GroupRuleDraftsOptions = {},
): RuleDraftGroup[] => {
  const by = options.by ?? 'source';
  const sortOptions = options.sort
    ? {
        ...options.sort,
        marketRows: options.sort.marketRows ?? options.marketRows ?? [],
      }
    : undefined;
  const orderedRules = sortOptions ? sortRuleDrafts(rules, sortOptions) : [...rules];
  const groupMap = new Map<string, RuleDraftGroup>();

  orderedRules.forEach((rule) => {
    const group = resolveRuleGroup(rule, by);
    const current = groupMap.get(group.key);

    if (current) {
      current.rules.push(rule);
      current.count += 1;
      return;
    }

    groupMap.set(group.key, {
      key: group.key,
      label: group.label,
      rules: [rule],
      count: 1,
    });
  });

  const order = RULE_GROUP_ORDER[by];
  return [...groupMap.values()].sort((left, right) => {
    const leftIndex = order.indexOf(left.key);
    const rightIndex = order.indexOf(right.key);

    if (leftIndex !== rightIndex) {
      if (leftIndex < 0) return 1;
      if (rightIndex < 0) return -1;
      return leftIndex - rightIndex;
    }

    return compareText(left.label, right.label);
  });
};

export const buildRuleDraftGroups = (
  rules: AlertRule[],
  options: BuildRuleDraftListOptions = {},
): RuleDraftGroup[] => {
  const marketRows = options.marketRows ?? [];
  const filtered = options.filter ? filterRuleDrafts(rules, options.filter, marketRows) : [...rules];
  const sortOptions = options.sort
    ? {
        ...options.sort,
        marketRows: options.sort.marketRows ?? marketRows,
      }
    : {
        ...DEFAULT_RULE_DRAFT_SORT,
        marketRows,
      };

  return groupRuleDrafts(filtered, {
    by: options.groupBy ?? 'source',
    sort: sortOptions,
    marketRows,
  });
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
    return RULE_SCOPE_GLOBAL_QUIET_HOURS_LABEL;
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
