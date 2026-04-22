import { useEffect, useMemo, useState } from 'react';

import { QuickControlPanel } from '../components/QuickControlPanel';
import { useI18n } from '../i18n';
import type {
  AlertRule,
  AppControlState,
  AppSettings,
  MarketRow,
  PreviewSoundPayload,
  RegisterSoundPayload,
  RulePreviewResult,
  RuntimeActionFeedback,
  SoundProfile,
} from '../types/contracts';
import {
  buildRuleConditionSummary,
  buildRuleEditorScopeOptions,
  buildRuleScopeSummary,
  filtersFromRule,
  formatRuleMetricLabel,
  formatRuleOperatorLabel,
  formatRuleSeverityLabel,
  formatRuleSourceLabel,
  normalizeRuleDrafts,
  quietHoursDraftToValue,
  quietHoursToDraft,
  replaceRuleScopeFilters,
  type RuleQuietHoursDraft,
  type RuleScopeFilters,
} from '../utils/rules-settings';

interface RulesSettingsViewProps {
  rules: AlertRule[];
  marketRows: MarketRow[];
  settings: AppSettings;
  controlState: AppControlState;
  runtimeAction: RuntimeActionFeedback;
  soundProfiles: SoundProfile[];
  onPreviewRule: (rule: AlertRule) => Promise<RulePreviewResult>;
  onSaveRules: (nextRules: AlertRule[]) => void;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onPickSound: (id: string) => void;
  onRegisterSound: (payload?: RegisterSoundPayload) => void;
  onPreviewSound: (payload: PreviewSoundPayload) => Promise<boolean>;
  onImportCityMap: (lines: string[]) => void;
  onSetNotificationsEnabled: (enabled: boolean) => void;
  onStopMonitor: () => void;
  onStartMonitor: () => void;
  onQuitApp: () => void;
}

const SOURCE_FILTERS = [
  { value: 'all', label: '全部规则' },
  { value: 'builtin', label: '系统规则' },
  { value: 'custom', label: '自定义规则' },
] as const;

const ENABLED_FILTERS = [
  { value: 'all', label: '全部状态' },
  { value: 'enabled', label: '只看已启用' },
  { value: 'disabled', label: '只看已停用' },
] as const;

const SEVERITY_FILTERS = [
  { value: 'all', label: '全部级别' },
  { value: 'critical', label: '紧急' },
  { value: 'warning', label: '预警' },
  { value: 'info', label: '提示' },
] as const;

const SCOPE_FILTERS = [
  { value: 'all', label: '全部范围' },
  { value: 'global', label: '全局规则' },
  { value: 'scoped', label: '指定范围' },
  { value: 'market', label: '指定市场' },
] as const;

const RULE_PAGE_TEXT = {
  search: '搜索规则',
  searchPlaceholder: '输入规则名、指标、城市或温度区间',
  source: '规则来源',
  enabledFilter: '启用状态',
  severityFilter: '告警级别',
  metricFilter: '监控指标',
  scopeFilter: '监控范围',
  allMetrics: '全部指标',
  clearFilters: '清空筛选',
  severity: '级别',
  noRules: '当前没有匹配的规则。',
  saveCurrent: '保存草稿',
  previewSelected: '预览影响',
  previewResult: (cities: number, markets: number) => `命中 ${cities} 个城市、${markets} 个盘口`,
  previewEmpty: '暂无预览结果。',
  settingsNote: '这里的声音、静音和城市映射会影响所有规则。',
  enabled: '已启用',
  disabled: '已停用',
  selectedRule: '当前选中规则',
  selectedRuleHint: '从规则列表选择一条后，这里会显示触发条件和范围。',
  noSelectedRule: '先从规则列表选择一条规则。',
  matchSummary: (visible: number, total: number) => `已匹配 ${visible} / ${total} 条规则`,
  editorHint: '修改先停留在草稿里，确认后再保存。',
  ruleEnabled: '启用这条规则',
  threshold: '阈值',
  windowSec: '观察窗口（秒）',
  cooldownSec: '冷却时间（秒）',
  dedupeWindowSec: '去重窗口（秒）',
  bubbleWeight: '风险权重',
  marketScope: '指定盘口',
  allMarkets: '全部盘口',
  cityScope: '城市',
  dateScope: '日期',
  bandScope: '温度区间',
  sideScope: '方向（是/否）',
  quietCustom: '单独静音',
  quietStart: '静音开始',
  quietEnd: '静音结束',
  draftSaved: '草稿已保存。',
  draftReset: '草稿已恢复为后台值。',
  registerSound: '登记当前提示音',
  previewSound: '试听提示音',
  importCityMap: '导入示例城市映射',
};

const RULE_DRAFT_DIRTY_TEXT = '草稿有未保存修改。';
const RULE_DRAFT_SYNCED_TEXT = '草稿与后台一致。';
const RULE_FILTER_PANEL_TEXT = {
  step: '第一步',
  title: '先筛选规则',
  hint: '按来源、状态、级别和关键词缩小范围，再选择要调整的规则。',
  commonTitle: '基础筛选',
  commonHint: '先用常用条件快速定位。',
  advancedTitle: '精确筛选',
  advancedHint: '需要更准时，再限定指标和范围。',
  matchedLabel: '当前匹配',
  activeLabel: '当前筛选',
  activeEmpty: '未启用筛选，显示全部规则。',
};
const RULE_LIST_PANEL_TEXT = {
  step: '第二步',
  title: '再从列表里找到目标规则',
  hint: '每条只保留名称、来源、触发条件和监控范围，先定位再调整。',
  countLabel: '条可选规则',
  condition: '触发条件',
  scope: '监控范围',
  quickSeverity: '快捷级别',
  quickStatus: '启用状态',
  empty: '当前筛选下没有可调整的规则。',
};

const RULE_EDITOR_SECTION_TEXT = {
  basic: {
    title: '基础设置',
    hint: '确认规则是否启用、名称是否清楚、级别是否合适。',
  },
  trigger: {
    title: '触发条件',
    hint: '设置指标、判断方式、阈值，以及观察、冷却和去重。',
  },
  scope: {
    title: '监控范围',
    hint: '限定这条规则作用到哪些盘口、城市、日期、温区和方向。',
  },
  quiet: {
    title: '静音与通知',
    hint: '只在需要单独静音时打开，再设置开始和结束时间。',
  },
};
const RULE_ACTION_PANEL_TEXT = {
  step: '第四步',
  title: '确认影响后再执行操作',
  hint: '看清当前规则、预览结果和草稿状态，再预览、保存或恢复。',
  selectedTitle: '当前规则',
  previewTitle: '预览结果',
  previewIdle: '暂无预览结果',
  previewBusy: '正在预览',
  previewDone: '最近预览',
  previewStale: '预览需更新',
  previewStaleHint: '设置已修改，请重新预览。',
  draftTitle: '草稿状态',
  draftDirty: '草稿未保存',
  draftSynced: '草稿已同步',
  restoreDraft: '恢复后台值',
};

type SourceFilter = (typeof SOURCE_FILTERS)[number]['value'];
type EnabledFilter = (typeof ENABLED_FILTERS)[number]['value'];
type SeverityFilter = (typeof SEVERITY_FILTERS)[number]['value'];
type ScopeFilter = (typeof SCOPE_FILTERS)[number]['value'];
type MetricFilter = 'all' | AlertRule['metric'];

const cleanText = (value?: string | null) => value?.trim() ?? '';

const METRIC_OPTIONS: AlertRule['metric'][] = [
  'price',
  'change5m',
  'spread',
  'liquidity_kill',
  'bidask_gap',
  'new_market',
  'resolved',
  'feed_stale',
];

const OPERATOR_OPTIONS: AlertRule['operator'][] = ['>', '>=', '<', '<=', 'crosses'];

const getRuleScopeFilter = (rule: AlertRule): Exclude<ScopeFilter, 'all'> => {
  if (cleanText(rule.scope?.marketId) || cleanText(rule.scope?.tokenId)) {
    return 'market';
  }
  if (
    cleanText(rule.scope?.cityKey) ||
    cleanText(rule.scope?.eventDate) ||
    cleanText(rule.scope?.temperatureBand) ||
    cleanText(rule.scope?.seriesSlug) ||
    (rule.scope?.side && rule.scope.side !== 'BOTH')
  ) {
    return 'scoped';
  }
  return 'global';
};

const countRules = (rules: AlertRule[], predicate: (rule: AlertRule) => boolean) =>
  rules.reduce((total, rule) => (predicate(rule) ? total + 1 : total), 0);

const buildRuleSearchText = (rule: AlertRule, marketRows: MarketRow[]) =>
  [
    rule.name,
    formatRuleSourceLabel(rule),
    formatRuleMetricLabel(rule.metric),
    formatRuleSeverityLabel(rule.severity),
    buildRuleConditionSummary(rule),
    buildRuleScopeSummary(rule, marketRows),
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('zh-CN');

const parseNumberInput = (value: string, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const createEmptyScopeFilters = (): RuleScopeFilters => ({
  cityKey: '',
  eventDate: '',
  temperatureBand: '',
  side: '',
  marketId: '',
});

export const RulesSettingsView = ({
  rules,
  marketRows,
  settings,
  controlState,
  runtimeAction,
  soundProfiles,
  onPreviewRule,
  onSaveRules,
  onUpdateSettings,
  onPickSound,
  onRegisterSound,
  onPreviewSound,
  onImportCityMap,
  onSetNotificationsEnabled,
  onStopMonitor,
  onStartMonitor,
  onQuitApp,
}: RulesSettingsViewProps) => {
  const { copy, policyLabel } = useI18n();
  const initialRules = normalizeRuleDrafts(rules);
  const [draftRules, setDraftRules] = useState<AlertRule[]>(() => initialRules);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [metricFilter, setMetricFilter] = useState<MetricFilter>('all');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [selectedRuleId, setSelectedRuleId] = useState<string>('');
  const [previewText, setPreviewText] = useState(RULE_PAGE_TEXT.previewEmpty);
  const [saveText, setSaveText] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [persistedRulesKey, setPersistedRulesKey] = useState(() => JSON.stringify(initialRules));

  useEffect(() => {
    const nextRules = normalizeRuleDrafts(rules);
    setDraftRules(nextRules);
    setPersistedRulesKey(JSON.stringify(nextRules));
  }, [rules]);

  const normalizedRules = useMemo(() => normalizeRuleDrafts(draftRules), [draftRules]);
  const draftRulesKey = useMemo(() => JSON.stringify(normalizedRules), [normalizedRules]);
  const hasUnsavedChanges = draftRulesKey !== persistedRulesKey;

  const scopeOptions = useMemo(
    () => buildRuleEditorScopeOptions(marketRows, normalizedRules),
    [marketRows, normalizedRules],
  );

  const metricOptions = useMemo(() => {
    const metrics = new Set<AlertRule['metric']>();
    normalizedRules.forEach((rule) => metrics.add(rule.metric));
    return [...metrics].sort((left, right) =>
      formatRuleMetricLabel(left).localeCompare(formatRuleMetricLabel(right), 'zh-CN'),
    );
  }, [normalizedRules]);

  const visibleRules = useMemo(() => {
    const keyword = cleanText(query).toLocaleLowerCase('zh-CN');

    return normalizedRules.filter((rule) => {
      if (sourceFilter === 'builtin' && !rule.isBuiltin) {
        return false;
      }
      if (sourceFilter === 'custom' && rule.isBuiltin) {
        return false;
      }
      if (enabledFilter === 'enabled' && !rule.enabled) {
        return false;
      }
      if (enabledFilter === 'disabled' && rule.enabled) {
        return false;
      }
      if (severityFilter !== 'all' && rule.severity !== severityFilter) {
        return false;
      }
      if (metricFilter !== 'all' && rule.metric !== metricFilter) {
        return false;
      }
      if (scopeFilter !== 'all' && getRuleScopeFilter(rule) !== scopeFilter) {
        return false;
      }
      if (keyword && !buildRuleSearchText(rule, marketRows).includes(keyword)) {
        return false;
      }
      return true;
    });
  }, [
    enabledFilter,
    marketRows,
    metricFilter,
    normalizedRules,
    query,
    scopeFilter,
    severityFilter,
    sourceFilter,
  ]);

  useEffect(() => {
    if (!selectedRuleId) {
      const fallbackId = visibleRules[0]?.id ?? '';
      if (fallbackId) {
        setSelectedRuleId(fallbackId);
      }
      return;
    }

    const stillVisible = visibleRules.some((rule) => rule.id === selectedRuleId);
    if (stillVisible) {
      return;
    }

    const fallbackId = visibleRules[0]?.id ?? '';
    if (fallbackId !== selectedRuleId) {
      setSelectedRuleId(fallbackId);
    }
  }, [selectedRuleId, visibleRules]);

  const selectedRule = visibleRules.find((rule) => rule.id === selectedRuleId) ?? null;

  const selectedScopeFilters = selectedRule ? filtersFromRule(selectedRule) : createEmptyScopeFilters();
  const selectedQuietDraft = selectedRule ? quietHoursToDraft(selectedRule.quietHours) : null;
  const saveStatusText = hasUnsavedChanges ? RULE_DRAFT_DIRTY_TEXT : saveText || RULE_DRAFT_SYNCED_TEXT;
  const selectedRuleSummary = selectedRule
    ? `${buildRuleConditionSummary(selectedRule)}；${buildRuleScopeSummary(selectedRule, marketRows)}`
    : RULE_PAGE_TEXT.selectedRuleHint;
  const previewFeedbackText = previewBusy
    ? RULE_ACTION_PANEL_TEXT.previewBusy
    : previewText === RULE_PAGE_TEXT.previewEmpty
      ? RULE_ACTION_PANEL_TEXT.previewIdle
      : previewText;
  const previewFeedbackTitle = previewBusy
    ? RULE_ACTION_PANEL_TEXT.previewBusy
    : previewText === RULE_PAGE_TEXT.previewEmpty
      ? RULE_ACTION_PANEL_TEXT.previewIdle
      : previewText === RULE_ACTION_PANEL_TEXT.previewStaleHint
        ? RULE_ACTION_PANEL_TEXT.previewStale
      : RULE_ACTION_PANEL_TEXT.previewDone;
  const previewFeedbackTone =
    previewBusy
      ? 'is-active'
      : previewText === RULE_PAGE_TEXT.previewEmpty
        ? 'is-muted'
        : previewText === RULE_ACTION_PANEL_TEXT.previewStaleHint
          ? 'is-warning'
        : previewText.includes('失败')
          ? 'is-danger'
          : 'is-info';
  const draftFeedbackTitle = hasUnsavedChanges
    ? RULE_ACTION_PANEL_TEXT.draftDirty
    : RULE_ACTION_PANEL_TEXT.draftSynced;

  const ruleStats = useMemo(
    () => [
      {
        label: '系统规则',
        value: countRules(normalizedRules, (rule) => Boolean(rule.isBuiltin)),
      },
      {
        label: '自定义规则',
        value: countRules(normalizedRules, (rule) => !rule.isBuiltin),
      },
      {
        label: '已启用',
        value: countRules(normalizedRules, (rule) => rule.enabled),
      },
      {
        label: '紧急级别',
        value: countRules(normalizedRules, (rule) => rule.severity === 'critical'),
      },
    ],
    [normalizedRules],
  );

  const hasActiveFilters =
    cleanText(query) ||
    sourceFilter !== 'all' ||
    enabledFilter !== 'all' ||
    severityFilter !== 'all' ||
    metricFilter !== 'all' ||
    scopeFilter !== 'all';

  const selectedSoundProfile =
    soundProfiles.find((profile) => profile.id === settings.selectedSoundProfileId) ??
    soundProfiles[0] ??
    null;
  const activeFilterBadges = [
    cleanText(query) ? `关键词：${query}` : '',
    sourceFilter !== 'all'
      ? `来源：${SOURCE_FILTERS.find((option) => option.value === sourceFilter)?.label ?? ''}`
      : '',
    enabledFilter !== 'all'
      ? `状态：${ENABLED_FILTERS.find((option) => option.value === enabledFilter)?.label ?? ''}`
      : '',
    severityFilter !== 'all'
      ? `级别：${SEVERITY_FILTERS.find((option) => option.value === severityFilter)?.label ?? ''}`
      : '',
    metricFilter !== 'all' ? `指标：${formatRuleMetricLabel(metricFilter)}` : '',
    scopeFilter !== 'all'
      ? `范围：${SCOPE_FILTERS.find((option) => option.value === scopeFilter)?.label ?? ''}`
      : '',
  ].filter((value): value is string => Boolean(value));

  const markPreviewStale = () => {
    if (previewText !== RULE_PAGE_TEXT.previewEmpty) {
      setPreviewText(RULE_ACTION_PANEL_TEXT.previewStaleHint);
    }
  };

  const updateRule = (ruleId: string, patch: Partial<AlertRule>) => {
    markPreviewStale();
    setDraftRules((currentRules) =>
      normalizeRuleDrafts(
        currentRules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
      ),
    );
  };

  const updateRuleScope = (ruleId: string, nextFilters: RuleScopeFilters) => {
    markPreviewStale();
    setDraftRules((currentRules) =>
      currentRules.map((rule) =>
        rule.id === ruleId ? replaceRuleScopeFilters(rule, nextFilters) : rule,
      ),
    );
  };

  const updateRuleQuietHours = (ruleId: string, quietHours: AlertRule['quietHours']) => {
    markPreviewStale();
    setDraftRules((currentRules) =>
      normalizeRuleDrafts(
        currentRules.map((rule) =>
          rule.id === ruleId
            ? {
                ...rule,
                quietHours,
              }
            : rule,
        ),
      ),
    );
  };

  const updateQuietDraft = (
    ruleId: string,
    currentDraft: RuleQuietHoursDraft,
    patch: Partial<RuleQuietHoursDraft>,
  ) => {
    const nextDraft = {
      ...currentDraft,
      ...patch,
    };
    updateRuleQuietHours(ruleId, quietHoursDraftToValue(nextDraft));
  };

  const handleMarketScopeChange = (rule: AlertRule, marketId: string) => {
    if (!marketId) {
      updateRuleScope(rule.id, {
        ...selectedScopeFilters,
        marketId: '',
      });
      return;
    }

    const option = scopeOptions.markets.find((item) => item.marketId === marketId);
    updateRuleScope(rule.id, {
      cityKey: option?.cityKey ?? '',
      eventDate: option?.eventDate ?? '',
      temperatureBand: option?.temperatureBand ?? '',
      side: option?.side === 'YES' || option?.side === 'NO' ? option.side : '',
      marketId,
    });
  };

  const handlePreviewFirstRule = async () => {
    if (!selectedRule) {
      setPreviewText(RULE_PAGE_TEXT.noSelectedRule);
      return;
    }

    setPreviewBusy(true);
    try {
      const result = await onPreviewRule(selectedRule);
      setPreviewText(RULE_PAGE_TEXT.previewResult(result.matchedCityCount, result.matchedMarketCount));
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message : '预览失败';
      setPreviewText(message);
    } finally {
      setPreviewBusy(false);
    }
  };

  const clearFilters = () => {
    setQuery('');
    setSourceFilter('all');
    setEnabledFilter('all');
    setSeverityFilter('all');
    setMetricFilter('all');
    setScopeFilter('all');
  };

  const handleSaveRules = () => {
    const nextRules = normalizeRuleDrafts(draftRules);
    setDraftRules(nextRules);
    setPersistedRulesKey(JSON.stringify(nextRules));
    onSaveRules(nextRules);
    setSaveText(RULE_PAGE_TEXT.draftSaved);
  };

  const handleResetDraft = () => {
    setDraftRules(normalizeRuleDrafts(rules));
    setSaveText(RULE_PAGE_TEXT.draftReset);
    setPreviewText(RULE_PAGE_TEXT.previewEmpty);
  };

  return (
    <section className="workspace">
      <section className="panel panel--full">
        <header className="panel__header">
          <div>
            <h2>{copy.settings.rulesTitle}</h2>
            <span>{RULE_PAGE_TEXT.matchSummary(visibleRules.length, normalizedRules.length)}</span>
          </div>
        </header>

        <section className="rules-filter-panel">
          <div className="rules-filter-panel__intro">
            <div>
              <p className="rules-filter-panel__eyebrow">{RULE_FILTER_PANEL_TEXT.step}</p>
              <h3>{RULE_FILTER_PANEL_TEXT.title}</h3>
              <p>{RULE_FILTER_PANEL_TEXT.hint}</p>
            </div>
            <div className="rules-filter-panel__summary">
              <strong>{visibleRules.length}</strong>
              <span>{RULE_FILTER_PANEL_TEXT.matchedLabel}</span>
              <em>共 {normalizedRules.length} 条规则</em>
            </div>
          </div>

          <div className="rules-filter-panel__search">
            <label className="field field--grow">
              <span>{RULE_PAGE_TEXT.search}</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={RULE_PAGE_TEXT.searchPlaceholder}
              />
            </label>
            <button
              type="button"
              className="ghost-button"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
            >
              {RULE_PAGE_TEXT.clearFilters}
            </button>
          </div>

          <div className="rules-filter-grid">
            <section className="rules-filter-group">
              <div className="rules-filter-group__head">
                <strong>{RULE_FILTER_PANEL_TEXT.commonTitle}</strong>
                <span>{RULE_FILTER_PANEL_TEXT.commonHint}</span>
              </div>

              <div className="rules-filter-segments">
                <div className="rules-filter-segment">
                  <span>{RULE_PAGE_TEXT.source}</span>
                  <div className="rules-filter-chip-row">
                    {SOURCE_FILTERS.map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        className={`rules-filter-chip ${
                          sourceFilter === option.value ? 'is-active' : ''
                        }`}
                        aria-pressed={sourceFilter === option.value}
                        onClick={() => setSourceFilter(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rules-filter-segment">
                  <span>{RULE_PAGE_TEXT.enabledFilter}</span>
                  <div className="rules-filter-chip-row">
                    {ENABLED_FILTERS.map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        className={`rules-filter-chip ${
                          enabledFilter === option.value ? 'is-active' : ''
                        }`}
                        aria-pressed={enabledFilter === option.value}
                        onClick={() => setEnabledFilter(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rules-filter-segment">
                  <span>{RULE_PAGE_TEXT.severityFilter}</span>
                  <div className="rules-filter-chip-row">
                    {SEVERITY_FILTERS.map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        className={`rules-filter-chip ${
                          severityFilter === option.value ? 'is-active' : ''
                        }`}
                        aria-pressed={severityFilter === option.value}
                        onClick={() => setSeverityFilter(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="rules-filter-group rules-filter-group--compact">
              <div className="rules-filter-group__head">
                <strong>{RULE_FILTER_PANEL_TEXT.advancedTitle}</strong>
                <span>{RULE_FILTER_PANEL_TEXT.advancedHint}</span>
              </div>

              <div className="rules-filter-selects">
                <label className="field">
                  <span>{RULE_PAGE_TEXT.metricFilter}</span>
                  <select
                    value={metricFilter}
                    onChange={(event) => setMetricFilter(event.target.value as MetricFilter)}
                  >
                    <option value="all">{RULE_PAGE_TEXT.allMetrics}</option>
                    {metricOptions.map((metric) => (
                      <option key={metric} value={metric}>
                        {formatRuleMetricLabel(metric)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>{RULE_PAGE_TEXT.scopeFilter}</span>
                  <select
                    value={scopeFilter}
                    onChange={(event) => setScopeFilter(event.target.value as ScopeFilter)}
                  >
                    {SCOPE_FILTERS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>
          </div>

          <div className="rules-filter-active">
            <span className="rules-filter-active__label">{RULE_FILTER_PANEL_TEXT.activeLabel}</span>
            {activeFilterBadges.length > 0 ? (
              activeFilterBadges.map((item) => (
                <span className="rules-filter-badge" key={item}>
                  {item}
                </span>
              ))
            ) : (
              <p className="rules-filter-empty">{RULE_FILTER_PANEL_TEXT.activeEmpty}</p>
            )}
          </div>
        </section>

        <div className="panel-section rule-editor-layout">
          <div className="topbar__grid">
            {ruleStats.map((item) => (
              <div className="topbar__metric" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>

          <div className="control-progress rule-editor-layout__summary">
            <div className="rule-action-panel__head">
              <div className="rule-action-panel__intro">
                <p className="rule-action-panel__eyebrow">{RULE_ACTION_PANEL_TEXT.step}</p>
                <h3>{RULE_ACTION_PANEL_TEXT.title}</h3>
                <p>{RULE_ACTION_PANEL_TEXT.hint}</p>
              </div>
              <div className="rule-action-panel__buttons">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handlePreviewFirstRule}
                  disabled={previewBusy || !selectedRule}
                >
                  {previewBusy ? RULE_ACTION_PANEL_TEXT.previewBusy : RULE_PAGE_TEXT.previewSelected}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleSaveRules}
                  disabled={!hasUnsavedChanges}
                >
                  {RULE_PAGE_TEXT.saveCurrent}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={handleResetDraft}
                  disabled={!hasUnsavedChanges}
                >
                  {RULE_ACTION_PANEL_TEXT.restoreDraft}
                </button>
              </div>
            </div>
            <div className="rule-action-panel__grid">
              <article className="rule-action-card">
                <span className="rule-action-card__label">{RULE_ACTION_PANEL_TEXT.selectedTitle}</span>
                <strong>{selectedRule ? selectedRule.name : RULE_PAGE_TEXT.noSelectedRule}</strong>
                <p>{selectedRuleSummary}</p>
              </article>
              <article className={`rule-action-card ${previewFeedbackTone}`}>
                <span className="rule-action-card__label">{RULE_ACTION_PANEL_TEXT.previewTitle}</span>
                <strong>{previewFeedbackTitle}</strong>
                <p>{previewFeedbackText}</p>
              </article>
              <article
                className={`rule-action-card ${hasUnsavedChanges ? 'is-warning' : 'is-success'}`}
              >
                <span className="rule-action-card__label">{RULE_ACTION_PANEL_TEXT.draftTitle}</span>
                <strong>{draftFeedbackTitle}</strong>
                <p>{saveStatusText}</p>
              </article>
            </div>
          </div>

          {selectedRule ? (
            <section className="rule-editor-layout__form">
              <div className="rule-editor-layout__section-head">
                <strong>第三步：调整选中规则</strong>
                <span>{formatRuleSourceLabel(selectedRule)}</span>
              </div>
              <p className="control-progress__text">{RULE_PAGE_TEXT.editorHint}</p>

              <div className="rule-editor-layout__sections">
                <section className="rule-editor-section">
                  <div className="rule-editor-section__head">
                    <strong>{RULE_EDITOR_SECTION_TEXT.basic.title}</strong>
                    <span>{RULE_EDITOR_SECTION_TEXT.basic.hint}</span>
                  </div>

                  <div className="rule-editor-section__grid">
                    <label className="field field--checkbox">
                      <input
                        type="checkbox"
                        checked={selectedRule.enabled}
                        onChange={(event) =>
                          updateRule(selectedRule.id, {
                            enabled: event.target.checked,
                          })
                        }
                      />
                      <span>{RULE_PAGE_TEXT.ruleEnabled}</span>
                    </label>

                    <label className="field">
                      <span>{copy.settings.name}</span>
                      <input
                        value={selectedRule.name}
                        onChange={(event) =>
                          updateRule(selectedRule.id, {
                            name: event.target.value,
                          })
                        }
                      />
                    </label>

                    <label className="field">
                      <span>{RULE_PAGE_TEXT.severity}</span>
                      <select
                        value={selectedRule.severity}
                        onChange={(event) =>
                          updateRule(selectedRule.id, {
                            severity: event.target.value as AlertRule['severity'],
                          })
                        }
                      >
                        {SEVERITY_FILTERS.filter((option) => option.value !== 'all').map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </section>

                <section className="rule-editor-section">
                  <div className="rule-editor-section__head">
                    <strong>{RULE_EDITOR_SECTION_TEXT.trigger.title}</strong>
                    <span>{RULE_EDITOR_SECTION_TEXT.trigger.hint}</span>
                  </div>

                  <div className="rule-editor-section__grid">
                    <label className="field">
                      <span>{copy.settings.metric}</span>
                      <select
                        value={selectedRule.metric}
                        onChange={(event) =>
                          updateRule(selectedRule.id, {
                            metric: event.target.value as AlertRule['metric'],
                          })
                        }
                      >
                        {METRIC_OPTIONS.map((metric) => (
                          <option key={metric} value={metric}>
                            {formatRuleMetricLabel(metric)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>判断方式</span>
                      <select
                        value={selectedRule.operator}
                        onChange={(event) =>
                          updateRule(selectedRule.id, {
                            operator: event.target.value as AlertRule['operator'],
                          })
                        }
                      >
                        {OPERATOR_OPTIONS.map((operator) => (
                          <option key={operator} value={operator}>
                            {formatRuleOperatorLabel(operator)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>{RULE_PAGE_TEXT.threshold}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={selectedRule.threshold}
                        onChange={(event) =>
                          updateRule(selectedRule.id, {
                            threshold: parseNumberInput(event.target.value, selectedRule.threshold),
                          })
                        }
                      />
                    </label>

                    <label className="field">
                      <span>{RULE_PAGE_TEXT.windowSec}</span>
                      <input
                        type="number"
                        min={1}
                        value={selectedRule.windowSec}
                        onChange={(event) =>
                          updateRule(selectedRule.id, {
                            windowSec: parseNumberInput(event.target.value, selectedRule.windowSec),
                          })
                        }
                      />
                    </label>

                    <label className="field">
                      <span>{RULE_PAGE_TEXT.cooldownSec}</span>
                      <input
                        type="number"
                        min={0}
                        value={selectedRule.cooldownSec}
                        onChange={(event) =>
                          updateRule(selectedRule.id, {
                            cooldownSec: parseNumberInput(event.target.value, selectedRule.cooldownSec),
                          })
                        }
                      />
                    </label>

                    <label className="field">
                      <span>{RULE_PAGE_TEXT.dedupeWindowSec}</span>
                      <input
                        type="number"
                        min={0}
                        value={selectedRule.dedupeWindowSec}
                        onChange={(event) =>
                          updateRule(selectedRule.id, {
                            dedupeWindowSec: parseNumberInput(
                              event.target.value,
                              selectedRule.dedupeWindowSec,
                            ),
                          })
                        }
                      />
                    </label>

                    <label className="field">
                      <span>{RULE_PAGE_TEXT.bubbleWeight}</span>
                      <input
                        type="number"
                        min={0}
                        value={selectedRule.bubbleWeight}
                        onChange={(event) =>
                          updateRule(selectedRule.id, {
                            bubbleWeight: parseNumberInput(event.target.value, selectedRule.bubbleWeight),
                          })
                        }
                      />
                    </label>
                  </div>
                </section>

                <section className="rule-editor-section">
                  <div className="rule-editor-section__head">
                    <strong>{RULE_EDITOR_SECTION_TEXT.scope.title}</strong>
                    <span>{RULE_EDITOR_SECTION_TEXT.scope.hint}</span>
                  </div>

                  <div className="rule-editor-section__grid">
                    <label className="field">
                      <span>{RULE_PAGE_TEXT.marketScope}</span>
                      <select
                        value={selectedScopeFilters.marketId}
                        onChange={(event) => handleMarketScopeChange(selectedRule, event.target.value)}
                      >
                        <option value="">{RULE_PAGE_TEXT.allMarkets}</option>
                        {scopeOptions.markets.map((option) => (
                          <option key={option.marketId} value={option.marketId}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>{RULE_PAGE_TEXT.cityScope}</span>
                      <select
                        value={selectedScopeFilters.cityKey}
                        onChange={(event) =>
                          updateRuleScope(selectedRule.id, {
                            ...selectedScopeFilters,
                            cityKey: event.target.value,
                            marketId: '',
                          })
                        }
                      >
                        <option value="">全部城市</option>
                        {scopeOptions.cities.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>{RULE_PAGE_TEXT.dateScope}</span>
                      <select
                        value={selectedScopeFilters.eventDate}
                        onChange={(event) =>
                          updateRuleScope(selectedRule.id, {
                            ...selectedScopeFilters,
                            eventDate: event.target.value,
                            marketId: '',
                          })
                        }
                      >
                        <option value="">全部日期</option>
                        {scopeOptions.dates.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>{RULE_PAGE_TEXT.bandScope}</span>
                      <select
                        value={selectedScopeFilters.temperatureBand}
                        onChange={(event) =>
                          updateRuleScope(selectedRule.id, {
                            ...selectedScopeFilters,
                            temperatureBand: event.target.value,
                            marketId: '',
                          })
                        }
                      >
                        <option value="">全部温度区间</option>
                        {scopeOptions.bands.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>{RULE_PAGE_TEXT.sideScope}</span>
                      <select
                        value={selectedScopeFilters.side}
                        onChange={(event) =>
                          updateRuleScope(selectedRule.id, {
                            ...selectedScopeFilters,
                            side: event.target.value as RuleScopeFilters['side'],
                            marketId: '',
                          })
                        }
                      >
                        {scopeOptions.sides.map((option) => (
                          <option key={option.value || 'all'} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </section>

                <section className="rule-editor-section">
                  <div className="rule-editor-section__head">
                    <strong>{RULE_EDITOR_SECTION_TEXT.quiet.title}</strong>
                    <span>{RULE_EDITOR_SECTION_TEXT.quiet.hint}</span>
                  </div>

                  <div className="rule-editor-section__grid">
                    <label className="field field--checkbox">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedRule.quietHours)}
                        onChange={(event) =>
                          updateRuleQuietHours(
                            selectedRule.id,
                            event.target.checked
                              ? quietHoursDraftToValue({ start: '23:00', end: '06:00' })
                              : undefined,
                          )
                        }
                      />
                      <span>{RULE_PAGE_TEXT.quietCustom}</span>
                    </label>

                    <label className="field">
                      <span>{RULE_PAGE_TEXT.quietStart}</span>
                      <input
                        type="time"
                        value={selectedQuietDraft?.start ?? ''}
                        disabled={!selectedRule.quietHours || !selectedQuietDraft}
                        onChange={(event) =>
                          selectedQuietDraft
                            ? updateQuietDraft(selectedRule.id, selectedQuietDraft, {
                                start: event.target.value,
                              })
                            : undefined
                        }
                      />
                    </label>

                    <label className="field">
                      <span>{RULE_PAGE_TEXT.quietEnd}</span>
                      <input
                        type="time"
                        value={selectedQuietDraft?.end ?? ''}
                        disabled={!selectedRule.quietHours || !selectedQuietDraft}
                        onChange={(event) =>
                          selectedQuietDraft
                            ? updateQuietDraft(selectedRule.id, selectedQuietDraft, {
                                end: event.target.value,
                              })
                            : undefined
                        }
                      />
                    </label>
                  </div>
                </section>
              </div>
            </section>
          ) : null}

          <section className="rules-list-panel">
            <div className="rules-list-panel__head">
              <div>
                <p className="rules-list-panel__eyebrow">{RULE_LIST_PANEL_TEXT.step}</p>
                <h3>{RULE_LIST_PANEL_TEXT.title}</h3>
                <p>{RULE_LIST_PANEL_TEXT.hint}</p>
              </div>
              <div className="rules-list-panel__count">
                <strong>{visibleRules.length}</strong>
                <span>{RULE_LIST_PANEL_TEXT.countLabel}</span>
              </div>
            </div>

            {visibleRules.length > 0 ? (
              <div className="rules-card-list">
                {visibleRules.map((rule) => {
                  const isSelected = selectedRule?.id === rule.id;

                  return (
                    <article
                      key={rule.id}
                      className={`rule-card ${isSelected ? 'is-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedRuleId(rule.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedRuleId(rule.id);
                        }
                      }}
                    >
                      <div className="rule-card__main">
                        <div className="rule-card__top">
                          <div className="rule-card__title">
                            <strong>{rule.name}</strong>
                            <div className="rule-card__badges">
                              {isSelected ? (
                                <span className="rule-card__badge rule-card__badge--active">已选中</span>
                              ) : null}
                              <span className="rule-card__badge">{formatRuleSourceLabel(rule)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="rule-card__summary">
                          <div className="rule-card__summary-item">
                            <span>{RULE_LIST_PANEL_TEXT.condition}</span>
                            <strong>{buildRuleConditionSummary(rule)}</strong>
                          </div>
                          <div className="rule-card__summary-item">
                            <span>{RULE_LIST_PANEL_TEXT.scope}</span>
                            <strong>{buildRuleScopeSummary(rule, marketRows)}</strong>
                          </div>
                        </div>
                      </div>

                      <div
                        className="rule-card__actions"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <label className="field">
                          <span>{RULE_LIST_PANEL_TEXT.quickSeverity}</span>
                          <select
                            className="rule-quick-select"
                            value={rule.severity}
                            onChange={(event) =>
                              updateRule(rule.id, {
                                severity: event.target.value as AlertRule['severity'],
                              })
                            }
                          >
                            {SEVERITY_FILTERS.filter((option) => option.value !== 'all').map((option) => (
                              <option key={option.value} value={option.value}>
                                {formatRuleSeverityLabel(option.value as AlertRule['severity'])}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="field rule-card__toggle-field">
                          <span>{RULE_LIST_PANEL_TEXT.quickStatus}</span>
                          <label className="rule-quick-toggle">
                            <input
                              type="checkbox"
                              checked={rule.enabled}
                              onChange={(event) =>
                                updateRule(rule.id, {
                                  enabled: event.target.checked,
                                })
                              }
                            />
                            <span>{rule.enabled ? RULE_PAGE_TEXT.enabled : RULE_PAGE_TEXT.disabled}</span>
                          </label>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rules-list-empty">{RULE_LIST_PANEL_TEXT.empty}</div>
            )}
          </section>
        </div>
      </section>

      <section className="workspace-grid workspace-grid--wide">
        <section className="panel">
          <header className="panel__header">
            <div>
              <h2>{copy.settings.settingsTitle}</h2>
              <span>{copy.settings.settingsHint}</span>
            </div>
          </header>

          <div className="field-grid">
            <label className="field field--checkbox">
              <input
                type="checkbox"
                checked={settings.startOnBoot}
                onChange={(event) => onUpdateSettings({ startOnBoot: event.target.checked })}
              />
              <span>{copy.settings.startOnBoot}</span>
            </label>

            <label className="field field--checkbox">
              <input
                type="checkbox"
                checked={settings.backgroundAudio}
                onChange={(event) => onUpdateSettings({ backgroundAudio: event.target.checked })}
              />
              <span>{copy.settings.backgroundAudio}</span>
            </label>

            <label className="field">
              <span>{copy.settings.reconnectPolicy}</span>
              <select
                value={settings.reconnectPolicy}
                onChange={(event) =>
                  onUpdateSettings({
                    reconnectPolicy: event.target.value as AppSettings['reconnectPolicy'],
                  })
                }
              >
                <option value="aggressive">{policyLabel('aggressive')}</option>
                <option value="balanced">{policyLabel('balanced')}</option>
                <option value="conservative">{policyLabel('conservative')}</option>
              </select>
            </label>

            <label className="field">
              <span>{copy.settings.pollInterval}</span>
              <input
                type="number"
                min={5}
                value={settings.pollIntervalSec}
                onChange={(event) =>
                  onUpdateSettings({
                    pollIntervalSec: Math.max(5, Number(event.target.value) || 5),
                  })
                }
              />
            </label>

            <label className="field">
              <span>{copy.settings.quietStart}</span>
              <input
                type="time"
                value={settings.quietHoursStart}
                onChange={(event) => onUpdateSettings({ quietHoursStart: event.target.value })}
              />
            </label>

            <label className="field">
              <span>{copy.settings.quietEnd}</span>
              <input
                type="time"
                value={settings.quietHoursEnd}
                onChange={(event) => onUpdateSettings({ quietHoursEnd: event.target.value })}
              />
            </label>

            <label className="field">
              <span>{copy.settings.soundProfile}</span>
              <select
                value={selectedSoundProfile?.id ?? ''}
                onChange={(event) => onPickSound(event.target.value)}
              >
                {soundProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="field">
              <span>{copy.common.details}</span>
              <p className="rule-hint">{RULE_PAGE_TEXT.settingsNote}</p>
            </div>
          </div>

          <div className="action-row">
            <button
              type="button"
              className="ghost-button"
              onClick={() =>
                selectedSoundProfile
                  ? void onPreviewSound({
                      id: selectedSoundProfile.id,
                      gain: selectedSoundProfile.gain,
                    })
                  : undefined
              }
              disabled={!selectedSoundProfile}
            >
              {RULE_PAGE_TEXT.previewSound}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() =>
                onRegisterSound({
                  id: selectedSoundProfile?.id,
                  name: selectedSoundProfile?.name,
                  gain: selectedSoundProfile?.gain,
                  setAsDefault: true,
                })
              }
              disabled={!selectedSoundProfile}
            >
              {RULE_PAGE_TEXT.registerSound}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => onImportCityMap(['tokyo,RJTT', 'new-york,KJFK'])}
            >
              {RULE_PAGE_TEXT.importCityMap}
            </button>
          </div>
        </section>

        <QuickControlPanel
          controlState={controlState}
          runtimeAction={runtimeAction}
          onToggleNotifications={onSetNotificationsEnabled}
          onStopMonitor={onStopMonitor}
          onStartMonitor={onStartMonitor}
          onQuitApp={onQuitApp}
        />
      </section>
    </section>
  );
};
