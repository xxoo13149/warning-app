import { useEffect, useMemo, useState } from 'react';

import { QuickControlPanel } from '../components/QuickControlPanel';
import type { MonitorRuntimeIssue } from '../hooks/useMonitorConsole';
import { useI18n } from '../i18n';
import {
  DEFAULT_ALERT_RETENTION_DAYS,
  DEFAULT_TICK_RETENTION_DAYS,
  MAX_ALERT_RETENTION_DAYS,
  MAX_TICK_RETENTION_DAYS,
  MIN_ALERT_RETENTION_DAYS,
  MIN_TICK_RETENTION_DAYS,
} from '../../shared/constants';
import type {
  AlertRule,
  AppControlState,
  AppHealth,
  AppSettings,
  MarketRow,
  PreviewSoundPayload,
  PreviewSoundResult,
  RegisterSoundPayload,
  RuntimeDiagnosticsPackageResult,
  RuntimeStorageSummary,
  RulePreviewResult,
  StorageMaintenanceResult,
  StorageMaintenanceSummary,
  StorageBackupResult,
  StorageCleanupResult,
  RuntimeActionFeedback,
  SoundProfile,
} from '../types/contracts';
import {
  buildRuleConditionSummary,
  buildRuleEditorScopeOptions,
  buildRuleScopeSummary,
  filtersFromRule,
  formatLiquiditySideLabel,
  formatRuleDuration,
  formatRuleMetricLabel,
  formatRuleOperatorLabel,
  formatRuleSourceLabel,
  normalizeRuleDrafts,
  quietHoursDraftToValue,
  quietHoursToDraft,
  replaceRuleScopeFilters,
  type RuleQuietHoursDraft,
  type RuleScopeFilters,
} from '../utils/rules-settings';

const SAMPLE_CITY_MAP_LINES = ['tokyo,RJTT,Asia/Tokyo', 'nyc,KNYC,America/New_York'];

type SettingsFeedbackTone = 'muted' | 'success' | 'warning' | 'danger';
type RuleDiagnosticTone = SettingsFeedbackTone;

interface RuleDiagnosticItem {
  label: string;
  value: string;
  hint: string;
  tone: RuleDiagnosticTone;
}

interface RuleDiagnostic {
  tone: RuleDiagnosticTone;
  title: string;
  summary: string;
  items: RuleDiagnosticItem[];
}

interface RuleTriggerGuideItem {
  label: string;
  value: string;
  hint: string;
}

interface RuleTriggerGuide {
  title: string;
  summary: string;
  thresholdHint: string;
  items: RuleTriggerGuideItem[];
}

interface RuleScopeGuideItem {
  label: string;
  value: string;
  hint: string;
}

interface RuleScopeGuide {
  tone: 'muted' | 'success' | 'warning';
  title: string;
  summary: string;
  items: RuleScopeGuideItem[];
}

interface RuleListSignal {
  tone: SettingsFeedbackTone;
  statusText: string;
  coverageText: string;
  hitText: string;
  hint: string;
}

interface RulesSettingsViewProps {
  rules: AlertRule[];
  marketRows: MarketRow[];
  latestAlertAtByRuleId: Record<string, string | undefined>;
  health: AppHealth;
  settings: AppSettings;
  storageSummary: RuntimeStorageSummary | null;
  storageMaintenance: StorageMaintenanceSummary | null;
  controlState: AppControlState;
  runtimeAction: RuntimeActionFeedback;
  runtimeIssues?: MonitorRuntimeIssue[];
  soundProfiles: SoundProfile[];
  onPreviewRule: (rule: AlertRule) => Promise<RulePreviewResult>;
  onSaveRules: (nextRules: AlertRule[]) => void;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void> | void;
  onPickSound: (id: string) => Promise<void> | void;
  onRegisterSound: (payload?: RegisterSoundPayload) => Promise<void> | void;
  onClearStorageCache: () => Promise<StorageCleanupResult>;
  onCreateStorageBackup: () => Promise<StorageBackupResult>;
  onCreateDiagnosticsPackage: () => Promise<RuntimeDiagnosticsPackageResult>;
  onRunStorageMaintenance: () => Promise<StorageMaintenanceResult>;
  onPreviewSound: (payload: PreviewSoundPayload) => Promise<PreviewSoundResult>;
  onImportCityMap: (lines: string[]) => Promise<number> | number;
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
  metricFilter: '监控指标',
  scopeFilter: '监控范围',
  allMetrics: '全部指标',
  clearFilters: '清空筛选',
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
  hint: '按来源、状态、关键词、指标和范围缩小范围，再选择要调整的规则。',
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
  quickStatus: '启用状态',
  empty: '当前筛选下没有可调整的规则。',
};

const RULE_EDITOR_SECTION_TEXT = {
  basic: {
    title: '基础设置',
    hint: '确认规则是否启用、名称是否清楚。',
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

const STORAGE_CLEAR_RECOMMENDATION_HIGH_BYTES = 512 * 1024 * 1024;

type SourceFilter = (typeof SOURCE_FILTERS)[number]['value'];
type EnabledFilter = (typeof ENABLED_FILTERS)[number]['value'];
type ScopeFilter = (typeof SCOPE_FILTERS)[number]['value'];
type MetricFilter = 'all' | AlertRule['metric'];

const cleanText = (value?: string | null) => value?.trim() ?? '';

const METRIC_OPTIONS: AlertRule['metric'][] = [
  'price',
  'change5m',
  'spread',
  'liquidity_kill',
  'volume_pricing',
  'bidask_gap',
  'new_market',
  'resolved',
  'feed_stale',
];

const OPERATOR_OPTIONS: AlertRule['operator'][] = ['>', '>=', '<', '<=', 'crosses'];

const LIQUIDITY_SIDE_OPTIONS: Array<{
  value: NonNullable<AlertRule['liquiditySide']>;
  label: string;
}> = [
  { value: 'both', label: '买卖两边' },
  { value: 'buy', label: '只看买盘' },
  { value: 'sell', label: '只看卖盘' },
];

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

const parseClockTimeToMinutes = (value: string): number | null => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
};

const isCurrentTimeInQuietHours = (startText: string, endText: string): boolean => {
  const start = parseClockTimeToMinutes(startText);
  const end = parseClockTimeToMinutes(endText);
  if (start === null || end === null) {
    return false;
  }

  if (start === end) {
    return true;
  }

  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
};

const hasNumber = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const formatCentsText = (value: number | null | undefined) => {
  if (!hasNumber(value)) {
    return '暂无';
  }
  return `${Math.round(value * 100)} 美分`;
};

const formatPercentText = (value: number | null | undefined) => {
  if (!hasNumber(value)) {
    return '暂无';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
};

const formatDateTimeText = (value: string) => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return '时间未知';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
};

const formatOptionalDateTimeText = (value: string | null | undefined) =>
  value ? formatDateTimeText(value) : '暂无';

const formatOptionalDurationText = (value: number | null | undefined) => {
  if (!hasNumber(value) || value <= 0) {
    return '暂无';
  }
  if (value < 1_000) {
    return `${Math.round(value)} ms`;
  }
  return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)} s`;
};

const formatFileSizeText = (value: number | null | undefined) => {
  if (!hasNumber(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 100 || unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
};

const compareRuleValue = (
  value: number | null | undefined,
  operator: AlertRule['operator'],
  threshold: number,
) => {
  if (!hasNumber(value) || !Number.isFinite(threshold)) {
    return false;
  }
  switch (operator) {
    case '>':
      return value > threshold;
    case '>=':
      return value >= threshold;
    case '<':
      return value < threshold;
    case '<=':
      return value <= threshold;
    case 'crosses':
      return value >= threshold;
    default:
      return false;
  }
};

const rowMatchesRuleScope = (rule: AlertRule, row: MarketRow) => {
  if (rule.scope?.cityKey && row.cityKey !== rule.scope.cityKey) {
    return false;
  }
  if (rule.scope?.eventDate && row.eventDate !== rule.scope.eventDate) {
    return false;
  }
  if (rule.scope?.temperatureBand && row.temperatureBand !== rule.scope.temperatureBand) {
    return false;
  }
  if (rule.scope?.marketId && row.marketId !== rule.scope.marketId) {
    return false;
  }
  if (rule.scope?.side && rule.scope.side !== 'BOTH' && row.side !== rule.scope.side) {
    return false;
  }
  return true;
};

const getRowsForRuleScope = (rule: AlertRule, marketRows: MarketRow[]) =>
  rule.metric === 'feed_stale' ? [] : marketRows.filter((row) => rowMatchesRuleScope(rule, row));

const formatScopeSideText = (side?: RuleScopeFilters['side'] | AlertRule['scope']['side']) => {
  switch (side) {
    case 'YES':
      return '是';
    case 'NO':
      return '否';
    default:
      return '全部方向';
  }
};

const formatScopeBandText = (value?: string | null) => {
  const normalizedValue = cleanText(value);
  if (!normalizedValue) {
    return '全部温度区间';
  }
  return normalizedValue
    .replace(/(\d+(?:\.\d+)?)\s*[°º]?\s*[cC]\b/g, '$1℃')
    .replace(/\s+to\s+/gi, ' 至 ')
    .replace(/\s*-\s*/g, ' 至 ')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const formatPreviewSampleLabel = (row: RulePreviewResult['sampleMarkets'][number]) =>
  [
    cleanText(row.cityName) || row.cityKey,
    row.eventDate,
    formatScopeBandText(row.temperatureBand),
    formatScopeSideText(row.side),
  ]
    .filter(Boolean)
    .join(' · ');

const formatPreviewSampleQuote = (row: RulePreviewResult['sampleMarkets'][number]) => {
  const parts = [
    `买一 ${formatCentsText(row.bestBid)}`,
    `卖一 ${formatCentsText(row.bestAsk)}`,
  ];
  if (hasNumber(row.spread)) {
    parts.push(`价差 ${formatCentsText(row.spread)}`);
  }
  return parts.join(' · ');
};

const buildScopeMarketLabel = (row: MarketRow) =>
  [
    cleanText(row.cityName) || row.cityKey,
    row.eventDate,
    formatScopeBandText(row.temperatureBand),
    formatScopeSideText(row.side),
  ]
    .filter(Boolean)
    .join('，');

const getScopeCityLabel = (cityKey: string | undefined, marketRows: MarketRow[]) => {
  const normalizedCityKey = cleanText(cityKey);
  if (!normalizedCityKey) {
    return '全部城市';
  }
  return (
    marketRows.find((row) => row.cityKey === normalizedCityKey)?.cityName ||
    normalizedCityKey
  );
};

const getRuleCurrentValue = (rule: AlertRule, row: MarketRow) => {
  switch (rule.metric) {
    case 'price':
      return row.yesPrice;
    case 'change5m':
      return row.change5m;
    case 'spread':
    case 'bidask_gap':
      return row.spread;
    case 'liquidity_kill':
    case 'volume_pricing':
      return null;
    default:
      return null;
  }
};

const formatRuleValue = (rule: AlertRule, value: number | null | undefined) => {
  switch (rule.metric) {
    case 'change5m':
      return formatPercentText(value);
    case 'spread':
    case 'bidask_gap':
      return formatCentsText(value);
    case 'feed_stale':
      return hasNumber(value) ? `${Math.round(value)} 秒` : '暂无';
    case 'price':
    case 'liquidity_kill':
    case 'volume_pricing':
    default:
      return formatCentsText(value);
  }
};

const buildRuleDiagnostic = ({
  rule,
  marketRows,
  latestAlertAtByRuleId,
  health,
  hasUnsavedChanges,
  isQuietHoursActive,
  notificationsEnabled,
}: {
  rule: AlertRule | null;
  marketRows: MarketRow[];
  latestAlertAtByRuleId: Record<string, string | undefined>;
  health: AppHealth;
  hasUnsavedChanges: boolean;
  isQuietHoursActive: boolean;
  notificationsEnabled: boolean;
}): RuleDiagnostic => {
  if (!rule) {
    return {
      tone: 'muted',
      title: '先选择一条规则',
      summary: '选择规则后，这里会显示它为什么会触发、为什么暂时没有触发。',
      items: [
        { label: '规则状态', value: '未选择', hint: '先从规则列表里点一条规则。', tone: 'muted' },
      ],
    };
  }

  const latestAlertAt = latestAlertAtByRuleId[rule.id] ?? null;
  const scopedRows = getRowsForRuleScope(rule, marketRows);
  const triggeredRows = scopedRows.filter((row) =>
    compareRuleValue(getRuleCurrentValue(rule, row), rule.operator, rule.threshold),
  );
  const feedLagSec = Math.max(0, Math.round((health.serviceStatus?.lagMs ?? 0) / 1000));
  const feedTriggered =
    rule.metric === 'feed_stale' && compareRuleValue(feedLagSec, rule.operator, rule.threshold);
  const currentValue =
    triggeredRows[0]
      ? getRuleCurrentValue(rule, triggeredRows[0])
      : scopedRows[0]
        ? getRuleCurrentValue(rule, scopedRows[0])
        : null;

  const disabledReason = !rule.enabled
    ? '这条规则已停用，后台不会按它生成告警。'
    : hasUnsavedChanges
      ? '草稿还没保存，后台仍按保存前的规则运行。'
      : rule.metric !== 'feed_stale' && scopedRows.length === 0
        ? '当前范围没有覆盖到任何盘口，请调整城市、日期、温区或盘口。'
        : rule.metric === 'feed_stale' && !health.serviceStatus
          ? '当前还没有数据流状态，等监控连接稳定后再判断。'
          : null;

  if (rule.metric === 'volume_pricing') {
    const coverageText = `${scopedRows.length} 个盘口`;
    const windowText = formatRuleDuration(rule.windowSec);
    const title = disabledReason
      ? '暂时不会触发'
      : latestAlertAt
        ? '最近捕捉到过带量定价'
        : scopedRows.length > 0
          ? '等待新的带量定价事件'
          : '当前范围没有覆盖盘口';
    const summary =
      disabledReason ??
      (scopedRows.length === 0
        ? '先把范围收窄到真正要盯的城市、日期、温区或单个盘口，否则这条规则不会命中。'
        : '这条规则看的是卖一在短窗口内被明显推高，并且要有成交量或盘口量确认；不是单纯看当前价格高低。');

    return {
      tone: disabledReason ? 'warning' : latestAlertAt ? 'success' : scopedRows.length > 0 ? 'muted' : 'warning',
      title,
      summary,
      items: [
        {
          label: '规则状态',
          value: rule.enabled ? '已启用' : '已停用',
          hint: rule.enabled ? '后台会持续监听新的带量定价事件。' : '开启后才会继续监听带量定价。',
          tone: rule.enabled ? 'success' : 'danger',
        },
        {
          label: '覆盖盘口',
          value: coverageText,
          hint:
            scopedRows.length > 0
              ? buildRuleScopeSummary(rule, marketRows)
              : '当前范围没有任何盘口样本，请先调整范围。',
          tone: scopedRows.length > 0 ? 'success' : 'warning',
        },
        {
          label: '触发逻辑',
          value: `卖一推高 ${formatRuleValue(rule, rule.threshold)}+`,
          hint: '例如卖一从 20 美分被推高到 40 美分，并且有成交或挂单量确认，才算带量定价。',
          tone: 'muted',
        },
        {
          label: '观察窗口',
          value: windowText,
          hint: `后台会在 ${windowText} 内比较卖一是否被推高，并自动做冷却和去重。`,
          tone: 'muted',
        },
        {
          label: '最近命中',
          value: latestAlertAt ? formatDateTimeText(latestAlertAt) : '暂无',
          hint: latestAlertAt ? '告警中心里可以查看这次带量定价的完整记录。' : '没有命中不代表异常，只代表还没出现有效量价事件。',
          tone: latestAlertAt ? 'success' : 'muted',
        },
      ],
    };
  }

  if (rule.metric === 'liquidity_kill') {
    const coverageText = `${scopedRows.length} 个盘口`;
    const windowText = formatRuleDuration(rule.windowSec);
    const title = disabledReason
      ? '暂时不会触发'
      : latestAlertAt
        ? '最近捕捉到过盘口斩杀'
        : scopedRows.length > 0
          ? '等待新的盘口斩杀事件'
          : '当前范围没有覆盖盘口';
    const summary =
      disabledReason ??
      (scopedRows.length === 0
        ? '先把范围收窄到真正要盯的城市、日期、温区或单个盘口，否则这条规则不会命中。'
        : '这条规则看的是短窗口内“顶档被清空”的事件，不适合用当前买一卖一直接判断会不会触发。');

    return {
      tone: disabledReason ? 'warning' : latestAlertAt ? 'success' : scopedRows.length > 0 ? 'muted' : 'warning',
      title,
      summary,
      items: [
        {
          label: '规则状态',
          value: rule.enabled ? '已启用' : '已停用',
          hint: rule.enabled ? '后台会持续监听新的盘口清空事件。' : '开启后才会继续监听盘口斩杀。 ',
          tone: rule.enabled ? 'success' : 'danger',
        },
        {
          label: '覆盖盘口',
          value: coverageText,
          hint:
            scopedRows.length > 0
              ? buildRuleScopeSummary(rule, marketRows)
              : '当前范围没有任何盘口样本，请先调整范围。',
          tone: scopedRows.length > 0 ? 'success' : 'warning',
        },
        {
          label: '监控盘口',
          value: formatLiquiditySideLabel(rule.liquiditySide),
          hint: '买盘指买一侧，卖盘指卖一侧；这不是 YES/NO 方向。',
          tone: 'muted',
        },
        {
          label: '触发门槛',
          value: `${formatRuleValue(rule, rule.threshold)} / ${windowText}`,
          hint: '只要被清空前的顶档价位不低于这个门槛，并且事件发生在观察窗口内，就会进入告警判断。',
          tone: 'muted',
        },
        {
          label: '最近告警',
          value: latestAlertAt ? formatDateTimeText(latestAlertAt) : '暂无',
          hint: latestAlertAt ? '这是最近一次写入告警中心的盘口斩杀记录。' : '当前已加载的告警里还没有这条规则的记录。',
          tone: latestAlertAt ? 'success' : 'muted',
        },
      ],
    };
  }

  const hasCurrentHit = rule.metric === 'feed_stale' ? feedTriggered : triggeredRows.length > 0;
  const tone = disabledReason
    ? 'warning'
    : hasCurrentHit
      ? 'success'
      : 'muted';
  const title = disabledReason
    ? '暂时不会触发'
    : hasCurrentHit
      ? '当前已达到触发条件'
      : '当前未达到触发条件';
  const summary = disabledReason ??
    (hasCurrentHit
      ? '后台会按冷却和去重规则写入告警；如果刚触发过，可能会等待窗口结束。'
      : '规则已经启用并覆盖盘口，但当前盘口数值还没碰到阈值。');

  const triggerHint =
    rule.metric === 'feed_stale'
      ? `当前数据延迟约 ${feedLagSec} 秒，阈值是 ${formatRuleValue(rule, rule.threshold)}。`
      : scopedRows.length > 0
        ? `样本当前值 ${formatRuleValue(rule, currentValue)}，阈值 ${formatRuleValue(rule, rule.threshold)}。`
        : '没有可用于判断的盘口样本。';

  return {
    tone,
    title,
    summary,
    items: [
      {
        label: '规则状态',
        value: rule.enabled ? '已启用' : '已停用',
        hint: rule.enabled ? '后台会评估这条规则。' : '打开启用开关后才会进入后台评估。',
        tone: rule.enabled ? 'success' : 'danger',
      },
      {
        label: '覆盖盘口',
        value: rule.metric === 'feed_stale' ? '数据流' : `${scopedRows.length} 个`,
        hint: rule.metric === 'feed_stale' ? '这类规则看实时数据流，不按单个盘口判断。' : buildRuleScopeSummary(rule, marketRows),
        tone: scopedRows.length > 0 || rule.metric === 'feed_stale' ? 'success' : 'warning',
      },
      {
        label: '当前命中',
        value: rule.metric === 'feed_stale'
          ? feedTriggered ? '已超过阈值' : '未超过阈值'
          : `${triggeredRows.length} 个`,
        hint: triggerHint,
        tone: hasCurrentHit ? 'success' : 'muted',
      },
      {
        label: '最近告警',
        value: latestAlertAt ? formatDateTimeText(latestAlertAt) : '暂无',
        hint: latestAlertAt ? '这是当前列表里这条规则最近一次写入时间。' : '当前已加载的告警里还没有这条规则的记录。',
        tone: latestAlertAt ? 'success' : 'muted',
      },
      {
        label: '提醒方式',
        value: !notificationsEnabled ? '通知关闭' : isQuietHoursActive ? '静音中' : '可提醒',
        hint: !notificationsEnabled
          ? '通知关闭不会影响告警中心记录，只是不弹系统通知。'
          : isQuietHoursActive
            ? '安静时段只静音弹窗和声音，告警仍会记录。'
            : '命中后会写入告警中心，并按设置弹通知和播放声音。',
        tone: !notificationsEnabled || isQuietHoursActive ? 'warning' : 'success',
      },
    ],
  };
};

const getRuleMetricPlainText = (metric: AlertRule['metric']) => {
  switch (metric) {
    case 'price':
      return '监控盘口价格是否到达指定位置。';
    case 'change5m':
      return '监控短时间内价格变化是否过快。';
    case 'spread':
      return '监控买一和卖一之间的价差是否过宽。';
    case 'liquidity_kill':
      return '监控短窗口内买一或卖一顶档是否被清空，这是一个事件型规则，不是静态价格阈值。';
    case 'volume_pricing':
      return '监控卖一是否在短窗口内被明显推高，并且有成交或盘口量确认。';
    case 'bidask_gap':
      return '监控买卖盘之间是否出现明显缺口。';
    case 'new_market':
      return '监控是否出现新的可交易盘口。';
    case 'resolved':
      return '监控盘口是否进入结算状态。';
    case 'feed_stale':
      return '监控行情数据是否长时间没有更新。';
    default:
      return '监控这个指标是否达到设定条件。';
  }
};

const getRuleThresholdHint = (metric: AlertRule['metric']) => {
  switch (metric) {
    case 'price':
      return '按 0 到 1 的价格填写，例如 0.5 表示 50 美分。';
    case 'liquidity_kill':
      return '填写“被清空前的最低顶档价位”，例如 0.2 表示只有清空 20 美分及以上的顶档才提醒。';
    case 'volume_pricing':
      return '填写“卖一被推高的最小幅度”，例如 0.1 表示至少推高 10 美分才提醒。';
    case 'spread':
    case 'bidask_gap':
      return '按盘口差值填写，例如 0.05 表示约 5 美分价差。';
    case 'change5m':
      return '直接填写百分比，例如 5 表示 5% 的变化。';
    case 'feed_stale':
      return '直接填写秒数，例如 90 表示 90 秒没有更新。';
    case 'new_market':
    case 'resolved':
      return '这类规则主要由后台事件判断，通常不用频繁调整阈值。';
    default:
      return '填写达到触发条件时要比较的数值。';
  }
};

const getRuleOperatorPlainText = (operator: AlertRule['operator']) => {
  switch (operator) {
    case '>':
      return '实际值大于阈值时触发。';
    case '>=':
      return '实际值大于或等于阈值时触发。';
    case '<':
      return '实际值小于阈值时触发。';
    case '<=':
      return '实际值小于或等于阈值时触发。';
    case 'crosses':
      return '从未达到变成达到阈值时触发，适合价格穿越。';
    default:
      return '按当前判断方式比较实际值和阈值。';
  }
};

const getRuleThresholdStep = (metric: AlertRule['metric']) => {
  switch (metric) {
    case 'change5m':
      return '0.1';
    case 'feed_stale':
      return '1';
    default:
      return '0.01';
  }
};

const buildRuleTriggerGuide = (rule: AlertRule): RuleTriggerGuide => {
  if (rule.metric === 'volume_pricing') {
    return {
      title: buildRuleConditionSummary(rule),
      summary: getRuleMetricPlainText(rule.metric),
      thresholdHint: getRuleThresholdHint(rule.metric),
      items: [
        {
          label: '监控指标',
          value: formatRuleMetricLabel(rule.metric),
          hint: '带量定价看的是卖一被推高后，是否有成交量、被移除盘口量或新卖一挂单量确认。',
        },
        {
          label: '判断方式',
          value: '卖一推高幅度',
          hint: '后台固定按“不低于最小推高幅度”判断，避免把方向和盘口侧设置得太复杂。',
        },
        {
          label: '最小推高幅度',
          value: formatRuleValue(rule, rule.threshold),
          hint: getRuleThresholdHint(rule.metric),
        },
        {
          label: '观察窗口',
          value: formatRuleDuration(rule.windowSec),
          hint: `后台会在 ${formatRuleDuration(rule.windowSec)} 内寻找从低卖一到高卖一的变化，并要求量能确认。`,
        },
      ],
    };
  }

  if (rule.metric === 'liquidity_kill') {
    return {
      title: buildRuleConditionSummary(rule),
      summary: getRuleMetricPlainText(rule.metric),
      thresholdHint: getRuleThresholdHint(rule.metric),
      items: [
        {
          label: '监控指标',
          value: formatRuleMetricLabel(rule.metric),
          hint: '新版盘口斩杀看的是“顶档被清空”这个事件，不是当前价格还剩多少。',
        },
        {
          label: '监控盘口',
          value: formatLiquiditySideLabel(rule.liquiditySide),
          hint: '买盘=买一侧，卖盘=卖一侧；如果选买卖两边，只要任意一边被清空就会判断。',
        },
        {
          label: '最低被清空价位',
          value: formatRuleValue(rule, rule.threshold),
          hint: getRuleThresholdHint(rule.metric),
        },
        {
          label: '观察窗口',
          value: formatRuleDuration(rule.windowSec),
          hint: `后台会在 ${formatRuleDuration(rule.windowSec)} 的窗口里看是否发生顶档清空，再叠加冷却和去重控制重复提醒。`,
        },
      ],
    };
  }

  return {
    title: buildRuleConditionSummary(rule),
    summary: getRuleMetricPlainText(rule.metric),
    thresholdHint: getRuleThresholdHint(rule.metric),
    items: [
      {
        label: '监控指标',
        value: formatRuleMetricLabel(rule.metric),
        hint: getRuleMetricPlainText(rule.metric),
      },
      {
        label: '判断方式',
        value: formatRuleOperatorLabel(rule.operator),
        hint: getRuleOperatorPlainText(rule.operator),
      },
      {
        label: '阈值写法',
        value: String(rule.threshold),
        hint: getRuleThresholdHint(rule.metric),
      },
      {
        label: '时间控制',
        value: `${formatRuleDuration(rule.windowSec)} / ${formatRuleDuration(rule.cooldownSec)}`,
        hint: `观察 ${formatRuleDuration(rule.windowSec)}；触发后冷却 ${formatRuleDuration(rule.cooldownSec)}。`,
      },
    ],
  };
};

const buildRuleScopeGuide = (rule: AlertRule, marketRows: MarketRow[]): RuleScopeGuide => {
  if (rule.metric === 'feed_stale') {
    return {
      tone: 'muted',
      title: '数据流规则不按盘口范围筛选',
      summary: '这条规则监控整体行情数据是否停更，不需要选择城市、日期或温区。',
      items: [
        {
          label: '监控对象',
          value: '实时数据流',
          hint: '它看数据更新状态，不看单个盘口价格。',
        },
        {
          label: '范围设置',
          value: '无需调整',
          hint: '城市、日期、温区不会改变这类规则的判断方式。',
        },
      ],
    };
  }

  const scopedRows = getRowsForRuleScope(rule, marketRows);
  const marketRow = rule.scope?.marketId
    ? marketRows.find((row) => row.marketId === rule.scope.marketId)
    : null;
  const hasPrimaryScope =
    cleanText(rule.scope?.cityKey) ||
    cleanText(rule.scope?.eventDate) ||
    cleanText(rule.scope?.temperatureBand) ||
    (rule.scope?.side && rule.scope.side !== 'BOTH');
  const modeText = rule.scope?.marketId
    ? '单一盘口'
    : hasPrimaryScope
      ? '条件筛选'
      : '全局监控';
  const cityText = getScopeCityLabel(rule.scope?.cityKey, marketRows);
  const dateText = cleanText(rule.scope?.eventDate) || '全部日期';
  const bandText = formatScopeBandText(rule.scope?.temperatureBand);
  const sideText = formatScopeSideText(rule.scope?.side);
  const marketText = marketRow
    ? buildScopeMarketLabel(marketRow)
    : rule.scope?.marketId
      ? `指定盘口 ${rule.scope.marketId}`
      : '不锁定单一盘口';

  return {
    tone: scopedRows.length > 0 ? 'success' : 'warning',
    title: scopedRows.length > 0 ? `当前覆盖 ${scopedRows.length} 个盘口` : '当前没有覆盖盘口',
    summary:
      scopedRows.length > 0
        ? buildRuleScopeSummary(rule, marketRows)
        : '当前范围没有匹配到盘口，保存后这条规则不会命中任何城市。',
    items: [
      {
        label: '范围模式',
        value: modeText,
        hint: rule.scope?.marketId
          ? '只盯一个具体盘口，适合非常精准的监控。'
          : '可以用城市、日期、温区和方向逐步缩小范围。',
      },
      {
        label: '城市和日期',
        value: `${cityText} / ${dateText}`,
        hint: '先定城市和日期，通常就能快速缩小大部分范围。',
      },
      {
        label: '温区和方向',
        value: `${bandText} / ${sideText}`,
        hint: '温区控制天气档位，方向控制是或否盘口。',
      },
      {
        label: '盘口选择',
        value: marketText,
        hint: `当前市场池共有 ${marketRows.length} 个盘口可用于匹配。`,
      },
    ],
  };
};

const buildRuleListSignal = (
  rule: AlertRule,
  marketRows: MarketRow[],
  health: AppHealth,
): RuleListSignal => {
  if (!rule.enabled) {
    return {
      tone: 'muted',
      statusText: '已停用',
      coverageText: rule.metric === 'feed_stale' ? '数据流' : `${getRowsForRuleScope(rule, marketRows).length} 个盘口`,
      hitText: '不评估',
      hint: '这条规则不会生成告警，打开启用后才会进入后台评估。',
    };
  }

  if (rule.metric === 'feed_stale') {
    const feedLagSec = Math.max(0, Math.round((health.serviceStatus?.lagMs ?? 0) / 1000));
    const isHit = compareRuleValue(feedLagSec, rule.operator, rule.threshold);
    return {
      tone: isHit ? 'success' : 'muted',
      statusText: '已启用',
      coverageText: '数据流',
      hitText: isHit ? '已命中' : '未命中',
      hint: `当前数据延迟约 ${feedLagSec} 秒。`,
    };
  }

  const scopedRows = getRowsForRuleScope(rule, marketRows);

  if (rule.metric === 'volume_pricing') {
    if (scopedRows.length === 0) {
      return {
        tone: 'warning',
        statusText: '已启用',
        coverageText: '0 个盘口',
        hitText: '按事件判断',
        hint: '当前范围没有覆盖盘口，后台就抓不到带量定价事件。',
      };
    }

    return {
      tone: 'muted',
      statusText: '已启用',
      coverageText: `${scopedRows.length} 个盘口`,
      hitText: '事件型规则',
      hint: `卖一在 ${formatRuleDuration(rule.windowSec)} 内被推高 ${formatRuleValue(rule, rule.threshold)} 以上，并且有量确认时提醒。`,
    };
  }

  if (rule.metric === 'liquidity_kill') {
    if (scopedRows.length === 0) {
      return {
        tone: 'warning',
        statusText: '已启用',
        coverageText: '0 个盘口',
        hitText: '按事件判断',
        hint: '当前范围没有覆盖盘口，后台就抓不到盘口斩杀事件。',
      };
    }

    return {
      tone: 'muted',
      statusText: '已启用',
      coverageText: `${scopedRows.length} 个盘口`,
      hitText: '事件型规则',
      hint: `监控 ${formatLiquiditySideLabel(rule.liquiditySide)} 顶档是否会在 ${formatRuleDuration(rule.windowSec)} 内被清空；当前买一卖一只用于预览覆盖范围。`,
    };
  }

  const hitRows = scopedRows.filter((row) =>
    compareRuleValue(getRuleCurrentValue(rule, row), rule.operator, rule.threshold),
  );

  if (scopedRows.length === 0) {
    return {
      tone: 'warning',
      statusText: '已启用',
      coverageText: '0 个盘口',
      hitText: '无命中',
      hint: '当前范围没有覆盖盘口，请先调整监控范围。',
    };
  }

  return {
    tone: hitRows.length > 0 ? 'success' : 'muted',
    statusText: '已启用',
    coverageText: `${scopedRows.length} 个盘口`,
    hitText: hitRows.length > 0 ? `${hitRows.length} 个命中` : '未命中',
    hint:
      hitRows.length > 0
        ? '当前已有盘口达到触发条件，真实告警仍受冷却和去重影响。'
        : '当前覆盖范围有盘口，但还没有达到触发条件。',
  };
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
  latestAlertAtByRuleId,
  health,
  settings,
  storageSummary,
  storageMaintenance,
  controlState,
  runtimeAction,
  runtimeIssues = [],
  soundProfiles,
  onPreviewRule,
  onSaveRules,
  onUpdateSettings,
  onPickSound,
  onRegisterSound,
  onClearStorageCache,
  onCreateStorageBackup,
  onCreateDiagnosticsPackage,
  onRunStorageMaintenance,
  onPreviewSound,
  onImportCityMap,
  onSetNotificationsEnabled,
  onStopMonitor,
  onStartMonitor,
  onQuitApp,
}: RulesSettingsViewProps) => {
  const { copy, language, policyLabel } = useI18n();
  const storageDefaultFeedbackText =
    language === 'en-US'
      ? 'Use Free Space for temporary content, save data copies before big changes, and let automatic space saving handle older records.'
      : '用“释放空间”处理临时内容，大调整前保存数据副本，较早记录会自动节省空间。';
  const initialRules = normalizeRuleDrafts(rules);
  const [draftRules, setDraftRules] = useState<AlertRule[]>(() => initialRules);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>('all');
  const [metricFilter, setMetricFilter] = useState<MetricFilter>('all');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [selectedRuleId, setSelectedRuleId] = useState<string>('');
  const [previewText, setPreviewText] = useState(RULE_PAGE_TEXT.previewEmpty);
  const [previewResult, setPreviewResult] = useState<RulePreviewResult | null>(null);
  const [saveText, setSaveText] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [soundFeedbackText, setSoundFeedbackText] = useState('提示音待试听。');
  const [soundFeedbackTone, setSoundFeedbackTone] = useState<SettingsFeedbackTone>('muted');
  const [soundBusyAction, setSoundBusyAction] =
    useState<'pick' | 'preview' | 'register' | null>(null);
  const [cityMapFeedbackText, setCityMapFeedbackText] = useState('城市映射待导入。');
  const [cityMapFeedbackTone, setCityMapFeedbackTone] = useState<SettingsFeedbackTone>('muted');
  const [cityMapBusy, setCityMapBusy] = useState(false);
  const [storageFeedbackText, setStorageFeedbackText] = useState(storageDefaultFeedbackText);
  const [storageFeedbackTone, setStorageFeedbackTone] =
    useState<SettingsFeedbackTone>('muted');
  const [storageBusyAction, setStorageBusyAction] =
    useState<'backup' | 'clear-cache' | 'diagnostics' | 'maintenance' | null>(null);
  const [persistedRulesKey, setPersistedRulesKey] = useState(() => JSON.stringify(initialRules));
  const isQuietHoursActive = isCurrentTimeInQuietHours(
    settings.quietHoursStart,
    settings.quietHoursEnd,
  );

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
    sourceFilter,
  ]);

  useEffect(() => {
    if (!selectedRuleId) {
      const fallbackId = visibleRules[0]?.id ?? normalizedRules[0]?.id ?? '';
      if (fallbackId) {
        setSelectedRuleId(fallbackId);
      }
      return;
    }

    const stillExists = normalizedRules.some((rule) => rule.id === selectedRuleId);
    if (stillExists) {
      return;
    }

    const fallbackId = visibleRules[0]?.id ?? normalizedRules[0]?.id ?? '';
    if (fallbackId !== selectedRuleId) {
      setSelectedRuleId(fallbackId);
    }
  }, [normalizedRules, selectedRuleId, visibleRules]);

  useEffect(() => {
    setPreviewText(RULE_PAGE_TEXT.previewEmpty);
    setPreviewResult(null);
  }, [selectedRuleId]);

  const selectedRule = normalizedRules.find((rule) => rule.id === selectedRuleId) ?? null;
  const selectedRuleHiddenByFilters =
    Boolean(selectedRule) && !visibleRules.some((rule) => rule.id === selectedRuleId);

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
  const selectedTriggerGuide = selectedRule ? buildRuleTriggerGuide(selectedRule) : null;
  const selectedScopeGuide = selectedRule ? buildRuleScopeGuide(selectedRule, marketRows) : null;
  const ruleDiagnostic = buildRuleDiagnostic({
    rule: selectedRule,
    marketRows,
    latestAlertAtByRuleId,
    health,
    hasUnsavedChanges,
    isQuietHoursActive,
    notificationsEnabled: controlState.notificationsEnabled,
  });

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
    ],
    [normalizedRules],
  );

  const hasActiveFilters =
    cleanText(query) ||
    sourceFilter !== 'all' ||
    enabledFilter !== 'all' ||
    metricFilter !== 'all' ||
    scopeFilter !== 'all';

  const selectedSoundProfile =
    soundProfiles.find((profile) => profile.id === settings.selectedSoundProfileId) ??
    soundProfiles[0] ??
    null;
  const soundRuntimeHint = !settings.backgroundAudio
    ? '后台播放提示音已关闭，真实告警只会记录和弹通知，不会自动响铃。'
    : isQuietHoursActive
      ? '当前处于安静时段，告警仍会记录到告警中心，但不会弹通知或自动响铃。'
      : '后台提示音已开启，规则真正触发时会自动播放当前提示音。';
  const notificationStatusItems = [
    {
      label: '系统通知',
      value: controlState.notificationsEnabled ? '已开启' : '已关闭',
      tone: controlState.notificationsEnabled ? 'success' : 'danger',
      hint: controlState.notificationsEnabled
        ? '允许弹出系统通知；是否有告警取决于规则是否命中。'
        : '已关闭，规则命中后也不会弹出系统通知。',
    },
    {
      label: '后台声音',
      value: settings.backgroundAudio ? '已开启' : '已关闭',
      tone: settings.backgroundAudio ? 'success' : 'warning',
      hint: soundRuntimeHint,
    },
    {
      label: '安静时段',
      value: isQuietHoursActive ? '正在生效' : `${settings.quietHoursStart} - ${settings.quietHoursEnd}`,
      tone: isQuietHoursActive ? 'warning' : 'muted',
      hint: isQuietHoursActive
        ? '这个时间段只静音通知和声音，告警记录仍会写入告警中心。'
        : '未处于静音窗口，规则命中后可以正常触发告警。',
    },
    {
      label: '当前提示音',
      value: selectedSoundProfile?.name ?? '未选择',
      tone: selectedSoundProfile ? 'success' : 'danger',
      hint: selectedSoundProfile
        ? selectedSoundProfile.isBuiltin
          ? '内置提示音，无需依赖外部文件。'
          : '自定义提示音，请确保原文件仍然存在。'
        : '请先选择一个提示音，否则真实告警无法播放声音。',
    },
  ] as const;
  const latestMainBackupAt =
    storageSummary?.latestMainBackupAt ?? storageSummary?.latestBackupAt ?? null;
  const latestMainBackupPath =
    storageSummary?.latestMainBackupPath ?? storageSummary?.latestBackupPath ?? null;
  const isMainDbMissing = storageSummary?.mainDbExists === false;
  const storageRecordCountFormatter = new Intl.NumberFormat(language === 'en-US' ? 'en-US' : 'zh-CN');
  const storageText =
    language === 'en-US'
      ? {
          coreReady: 'Saved data is ready',
          coreMissing: 'Saved data has not been created yet',
          coreMissingHint:
            'Start the app once and the saved-data status will appear here.',
          coreDataHint: (activityText: string, protectedText: string) =>
            `About ${protectedText} is saved. Recent activity: ${activityText}.`,
          cleanupValue: (sizeText: string) => `Free about ${sizeText}`,
          cleanupEmpty: 'No space to free right now',
          cleanupHint: (entryCount: number | null) =>
            entryCount && entryCount > 0
              ? `This removes ${entryCount} temporary items without deleting saved monitoring data.`
              : copy.settings.storageCanClearHint,
          backupValue: (timeText: string) => `Last saved copy: ${timeText}`,
          backupEmpty: 'No saved copy yet',
          backupHint: (count: number | null) =>
            count && count > 0
              ? `${count} saved copies are available. Save a fresh copy before upgrades or big changes.`
              : 'Save a data copy before upgrades, migrations, or major changes.',
          autoMaintenanceValue: (tickDays: number, alertDays: number) =>
            `Saving ${tickDays}/${alertDays} days`,
          autoMaintenanceHint: (lastRunText: string, durationText: string) =>
            `Last space-saving pass: ${lastRunText}. Duration: ${durationText}. Older records are handled automatically in the background.`,
          autoMaintenanceError: (errorText: string) => `Last space-saving pass failed: ${errorText}`,
          locationHint:
            'Saved data, long-term records, backups, temporary files, and logs are all kept here.',
          maintenanceIdle: 'Idle',
          maintenanceRunning: 'Saving space',
          maintenanceSuccess: 'Completed',
          maintenanceError: 'Failed',
          cleanupSuccess: (sizeText: string) => `Space freed. Reclaimed about ${sizeText}.`,
          backupSuccess: 'A new data copy has been saved. You can view its location in troubleshooting info.',
          diagnosticsBusy: 'Creating troubleshooting file...',
          diagnosticsButton: 'Create troubleshooting file',
          diagnosticsSuccess: (filePath: string) => `Troubleshooting file created: ${filePath}`,
          diagnosticsFailed: 'Troubleshooting file creation failed. Please retry.',
          maintenanceBusy: 'Saving space...',
          maintenanceButton: 'Save space now',
          maintenanceDone: 'Space-saving pass complete. Older records were handled using the active save settings.',
          maintenanceNoop: 'Storage is already tidy. Nothing needed this time.',
          maintenanceFailed: 'Space-saving pass failed. Please retry.',
          technicalCleanableEntries: 'Temporary items',
          technicalSessionData: 'Saved temporary data',
          technicalBackupFiles: 'Saved copies',
          technicalLogFiles: 'Log files',
          technicalLatestLog: 'Latest log write',
        }
      : {
          coreReady: '保存的数据已就绪',
          coreMissing: '保存的数据尚未生成',
          coreMissingHint: '启动一次应用后，这里会显示保存数据的状态。',
          coreDataHint: (activityText: string, protectedText: string) =>
            `已保存约 ${protectedText}；最近活动：${activityText}。`,
          cleanupValue: (sizeText: string) => `可释放约 ${sizeText}`,
          cleanupEmpty: '当前没有可释放空间',
          cleanupHint: (entryCount: number | null) =>
            entryCount && entryCount > 0
              ? `将清理 ${entryCount} 项临时内容，不会删除已保存的监控数据。`
              : copy.settings.storageCanClearHint,
          backupValue: (timeText: string) => `最近保存副本：${timeText}`,
          backupEmpty: '尚未保存副本',
          backupHint: (count: number | null) =>
            count && count > 0
              ? `当前已有 ${count} 份数据副本，升级或大调整前建议再保存一次。`
              : '建议在升级、迁移或大调整前先保存一份数据副本。',
          autoMaintenanceValue: (tickDays: number, alertDays: number) =>
            `保存 ${tickDays}/${alertDays} 天`,
          autoMaintenanceHint: (lastRunText: string, durationText: string) =>
            `最近节省空间：${lastRunText}；耗时：${durationText}。较早记录会在后台按保存天数自动处理。`,
          autoMaintenanceError: (errorText: string) => `最近节省空间失败：${errorText}`,
          locationHint: '已保存数据、长期记录、备份、临时内容和日志都会统一放在这里。',
          maintenanceIdle: '待机',
          maintenanceRunning: '节省空间中',
          maintenanceSuccess: '已完成',
          maintenanceError: '失败',
          cleanupSuccess: (sizeText: string) => `释放空间完成，已释放约 ${sizeText}。`,
          backupSuccess: '已保存新的数据副本，可在排查信息中查看位置。',
          diagnosticsBusy: '正在生成排查文件...',
          diagnosticsButton: '生成排查文件',
          diagnosticsSuccess: (filePath: string) => `排查文件已生成：${filePath}`,
          diagnosticsFailed: '排查文件生成失败，请稍后重试。',
          maintenanceBusy: '正在节省空间，请稍候...',
          maintenanceButton: '立即节省空间',
          maintenanceDone: '节省空间完成，较早记录已按保存设置处理。',
          maintenanceNoop: '当前数据已经是最新状态。',
          maintenanceFailed: '节省空间失败，请稍后重试。',
          technicalCleanableEntries: '临时内容项',
          technicalSessionData: '保留的临时数据',
          technicalBackupFiles: '数据副本数',
          technicalLogFiles: '日志文件数',
          technicalLatestLog: '最近日志写入',
        };
  const storageMaintenanceStatusText = !storageMaintenance
    ? storageText.maintenanceIdle
    : storageMaintenance.status === 'running'
      ? storageText.maintenanceRunning
      : storageMaintenance.status === 'success'
        ? storageText.maintenanceSuccess
        : storageMaintenance.status === 'error'
          ? storageText.maintenanceError
          : storageText.maintenanceIdle;
  const storageMaintenanceTone =
    storageMaintenance?.status === 'error'
      ? ('danger' as const)
      : storageMaintenance?.status === 'running'
        ? ('warning' as const)
      : storageMaintenance?.lastSuccessAt
          ? ('success' as const)
          : ('muted' as const);
  const storageMaintenanceHint =
    storageMaintenance?.status === 'error'
      ? storageText.autoMaintenanceError(storageMaintenance.lastError ?? 'unknown')
      : storageText.autoMaintenanceHint(
          formatOptionalDateTimeText(storageMaintenance?.lastRunAt),
          formatOptionalDurationText(storageMaintenance?.lastDurationMs),
        );
  const sessionPersistentSizeBytes = storageSummary
    ? storageSummary.sessionPersistentSizeBytes ??
      Math.max(0, storageSummary.sessionDataSizeBytes - storageSummary.cleanableSizeBytes)
    : 0;
  const protectedStorageSizeBytes = storageSummary
    ? (storageSummary.databaseSizeBytes || storageSummary.mainDbSizeBytes) +
      storageSummary.archiveSizeBytes +
      storageSummary.backupSizeBytes +
      sessionPersistentSizeBytes
    : 0;
  const storageBackupDisabledReason = isMainDbMissing
    ? copy.settings.storageCreateBackupMissingMainDb(
        storageSummary?.mainDbPath ?? copy.settings.storageMissing,
      )
    : null;
  const storageClearDisabledReason =
    !storageSummary || !storageSummary.canClearCache ? copy.settings.storageClearCacheEmpty : null;
  const resolvedStorageFeedbackText =
    storageBackupDisabledReason ?? storageFeedbackText;
  const resolvedStorageFeedbackTone = isMainDbMissing
    ? ('warning' as const)
    : storageFeedbackTone;
  const storageCleanupTone = !storageSummary
    ? ('warning' as const)
    : !storageSummary.canClearCache
      ? ('success' as const)
      : storageSummary.cleanableSizeBytes >= STORAGE_CLEAR_RECOMMENDATION_HIGH_BYTES
        ? ('warning' as const)
        : ('muted' as const);
  const storageOverviewItems = storageSummary
    ? [
        {
          label: copy.settings.storageCanClear,
          value: storageSummary.canClearCache
            ? storageText.cleanupValue(formatFileSizeText(storageSummary.cleanableSizeBytes))
            : storageText.cleanupEmpty,
          tone: storageCleanupTone,
          hint: storageSummary.canClearCache
            ? storageText.cleanupHint(storageSummary.cleanableEntryCount ?? null)
            : copy.settings.storageCanClearHint,
        },
        {
          label: copy.settings.storageProtectedData,
          value: storageSummary.mainDbExists ? storageText.coreReady : storageText.coreMissing,
          tone: storageSummary.mainDbExists ? ('success' as const) : ('warning' as const),
          hint: storageSummary.mainDbExists
            ? storageText.coreDataHint(
                formatOptionalDateTimeText(storageSummary.lastActivityAt),
                formatFileSizeText(protectedStorageSizeBytes),
              )
            : storageText.coreMissingHint,
        },
        {
          label: copy.settings.storageBackupProtection,
          value: latestMainBackupAt
            ? storageText.backupValue(formatOptionalDateTimeText(latestMainBackupAt))
            : storageText.backupEmpty,
          tone: latestMainBackupAt ? ('success' as const) : ('warning' as const),
          hint: storageText.backupHint(storageSummary.backupFileCount ?? null),
        },
        {
          label: copy.settings.storageAutoMaintenance,
          value: storageText.autoMaintenanceValue(
            settings.tickRetentionDays,
            settings.alertRetentionDays,
          ),
          tone: storageMaintenanceTone,
          hint: `${storageMaintenanceStatusText} · ${storageMaintenanceHint}`,
        },
      ]
    : [
        {
          label: copy.settings.storageProtectedData,
          value: storageText.coreMissing,
          tone: 'warning' as const,
          hint: storageText.coreMissingHint,
        },
      ];
  const storageTechnicalItems = storageSummary
    ? [
        {
          label: copy.settings.storageDataRoot,
          value: storageSummary.dataRootDir,
        },
        {
          label: copy.settings.storageDetailMainDbPath,
          value: storageSummary.mainDbPath,
        },
        {
          label: copy.settings.storageDetailArchiveDir,
          value: storageSummary.archiveDir,
        },
        {
          label: copy.settings.storageDetailBackupDir,
          value: storageSummary.backupDir,
        },
        {
          label: copy.settings.storageDetailSessionDir,
          value: storageSummary.sessionDataDir,
        },
        {
          label: copy.settings.storageDetailLogsDir,
          value: storageSummary.logsDir,
        },
        {
          label: copy.settings.storageDetailLastActivity,
          value: formatOptionalDateTimeText(storageSummary.lastActivityAt),
        },
        {
          label: copy.settings.storageDetailLastCleanup,
          value: formatOptionalDateTimeText(storageSummary.lastCleanupAt),
        },
        {
          label: storageText.technicalCleanableEntries,
          value: storageRecordCountFormatter.format(storageSummary.cleanableEntryCount ?? 0),
        },
        {
          label: storageText.technicalSessionData,
          value: formatFileSizeText(sessionPersistentSizeBytes),
        },
        {
          label: storageText.technicalBackupFiles,
          value: storageRecordCountFormatter.format(storageSummary.backupFileCount ?? 0),
        },
        {
          label: storageText.technicalLogFiles,
          value: storageRecordCountFormatter.format(storageSummary.logFileCount ?? 0),
        },
        {
          label: storageText.technicalLatestLog,
          value: formatOptionalDateTimeText(storageSummary.latestLogAt),
        },
        {
          label: copy.settings.storageDetailMarketHistory,
          value: `${storageRecordCountFormatter.format(storageSummary.priceTickCount)} ${copy.settings.storageDetailCountSuffix}`,
        },
        {
          label: copy.settings.storageDetailAlertHistory,
          value: `${storageRecordCountFormatter.format(storageSummary.alertEventCount)} ${copy.settings.storageDetailCountSuffix}`,
        },
      ]
    : [];
  const activeFilterBadges = [
    cleanText(query) ? `关键词：${query}` : '',
    sourceFilter !== 'all'
      ? `来源：${SOURCE_FILTERS.find((option) => option.value === sourceFilter)?.label ?? ''}`
      : '',
    enabledFilter !== 'all'
      ? `状态：${ENABLED_FILTERS.find((option) => option.value === enabledFilter)?.label ?? ''}`
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
    setPreviewResult(null);
  };

  const handlePreviewSound = async () => {
    if (!selectedSoundProfile) {
      setSoundFeedbackText('请先选择一个提示音。');
      setSoundFeedbackTone('danger');
      return;
    }

    setSoundBusyAction('preview');
    setSoundFeedbackText('正在试听提示音...');
    setSoundFeedbackTone('muted');
    try {
      const result = await onPreviewSound({
        id: selectedSoundProfile.id,
        gain: selectedSoundProfile.gain,
      });
      if (result.played) {
        setSoundFeedbackText(
          result.fallback === 'system-beep'
            ? `当前提示音没有直接播放成功，已改用系统提示音确认：${selectedSoundProfile.name}。`
            : settings.backgroundAudio
              ? `提示音已播放：${selectedSoundProfile.name}`
              : `提示音已播放：${selectedSoundProfile.name}。但后台播放提示音当前关闭，真实告警不会自动响铃。`,
        );
        setSoundFeedbackTone(
          result.fallback === 'system-beep'
            ? 'warning'
            : settings.backgroundAudio
              ? 'success'
              : 'warning',
        );
      } else {
        setSoundFeedbackText('没有播放成功，请检查系统声音或提示音文件。');
        setSoundFeedbackTone('danger');
      }
    } catch {
      setSoundFeedbackText('试听失败，请稍后再试。');
      setSoundFeedbackTone('danger');
    } finally {
      setSoundBusyAction(null);
    }
  };

  const handleRegisterSound = async () => {
    if (!selectedSoundProfile) {
      setSoundFeedbackText('请先选择一个提示音。');
      setSoundFeedbackTone('danger');
      return;
    }

    setSoundBusyAction('register');
    setSoundFeedbackText('正在登记当前提示音...');
    setSoundFeedbackTone('muted');
    try {
      await onRegisterSound({
        id: selectedSoundProfile.id,
        name: selectedSoundProfile.name,
        gain: selectedSoundProfile.gain,
        enabled: true,
        setAsDefault: true,
      });
      const result = await onPreviewSound({
        id: selectedSoundProfile.id,
        gain: selectedSoundProfile.gain,
      });
      setSoundFeedbackText(
        result.played
          ? result.fallback === 'system-beep'
            ? `已登记为默认提示音：${selectedSoundProfile.name}。当前提示音未直接播放，已用系统提示音确认。`
            : `已登记为默认提示音，并播放确认音：${selectedSoundProfile.name}`
          : `已登记为默认提示音：${selectedSoundProfile.name}。确认音没有播放，请检查系统声音。`,
      );
      setSoundFeedbackTone(
        result.played
          ? result.fallback === 'system-beep'
            ? 'warning'
            : 'success'
          : 'warning',
      );
    } catch {
      setSoundFeedbackText('登记失败，请稍后再试。');
      setSoundFeedbackTone('danger');
    } finally {
      setSoundBusyAction(null);
    }
  };

  const handlePickSound = async (soundId: string) => {
    const nextProfile = soundProfiles.find((profile) => profile.id === soundId);
    setSoundBusyAction('pick');
    setSoundFeedbackText('正在切换当前提示音...');
    setSoundFeedbackTone('muted');
    try {
      await onPickSound(soundId);
      setSoundFeedbackText(
        nextProfile
          ? `当前提示音已切换为：${nextProfile.name}`
          : '当前提示音已切换。',
      );
      setSoundFeedbackTone('success');
    } catch {
      setSoundFeedbackText('切换提示音失败，请稍后再试。');
      setSoundFeedbackTone('danger');
    } finally {
      setSoundBusyAction(null);
    }
  };

  const handleCreateStorageBackup = async () => {
    if (isMainDbMissing) {
      setStorageFeedbackText(
        storageBackupDisabledReason ??
          copy.settings.storageCreateBackupMissingMainDb(copy.settings.storageMissing),
      );
      setStorageFeedbackTone('warning');
      return;
    }

    setStorageBusyAction('backup');
    setStorageFeedbackText(copy.settings.storageCreateBackupBusy);
    setStorageFeedbackTone('muted');
    try {
      await onCreateStorageBackup();
      setStorageFeedbackText(storageText.backupSuccess);
      setStorageFeedbackTone('success');
    } catch {
      setStorageFeedbackText(copy.settings.storageCreateBackupFailed);
      setStorageFeedbackTone('danger');
    } finally {
      setStorageBusyAction(null);
    }
  };

  const handleCreateDiagnosticsPackage = async () => {
    setStorageBusyAction('diagnostics');
    setStorageFeedbackText(storageText.diagnosticsBusy);
    setStorageFeedbackTone('muted');
    try {
      const result = await onCreateDiagnosticsPackage();
      setStorageFeedbackText(storageText.diagnosticsSuccess(result.packagePath));
      setStorageFeedbackTone('success');
    } catch {
      setStorageFeedbackText(storageText.diagnosticsFailed);
      setStorageFeedbackTone('danger');
    } finally {
      setStorageBusyAction(null);
    }
  };

  const handleClearStorageCache = async () => {
    if (!storageSummary || !storageSummary.canClearCache) {
      setStorageFeedbackText(copy.settings.storageClearCacheEmpty);
      setStorageFeedbackTone('warning');
      return;
    }

    setStorageBusyAction('clear-cache');
    setStorageFeedbackText(copy.settings.storageClearCacheBusy);
    setStorageFeedbackTone('muted');
    try {
      const result = await onClearStorageCache();
      if (result.reclaimedBytes > 0) {
        setStorageFeedbackText(storageText.cleanupSuccess(formatFileSizeText(result.reclaimedBytes)));
        setStorageFeedbackTone('success');
      } else {
        setStorageFeedbackText(copy.settings.storageClearCacheEmpty);
        setStorageFeedbackTone('warning');
      }
    } catch {
      setStorageFeedbackText(copy.settings.storageClearCacheFailed);
      setStorageFeedbackTone('danger');
    } finally {
      setStorageBusyAction(null);
    }
  };

  const handleRunStorageMaintenance = async () => {
    if (isMainDbMissing) {
      setStorageFeedbackText(
        storageBackupDisabledReason ??
          copy.settings.storageCreateBackupMissingMainDb(copy.settings.storageMissing),
      );
      setStorageFeedbackTone('warning');
      return;
    }

    setStorageBusyAction('maintenance');
    setStorageFeedbackText(storageText.maintenanceBusy);
    setStorageFeedbackTone('muted');
    try {
      const result = await onRunStorageMaintenance();
      const archivedRows = result.summary.lastArchivedRows;
      const prunedTickRows = result.summary.lastPrunedTickRows;
      const prunedAlertRows = result.summary.lastPrunedAlertRows;
      const changedRows = archivedRows + prunedTickRows + prunedAlertRows;
      if (changedRows > 0) {
        setStorageFeedbackText(storageText.maintenanceDone);
      } else {
        setStorageFeedbackText(storageText.maintenanceNoop);
      }
      setStorageFeedbackTone('success');
    } catch {
      setStorageFeedbackText(storageText.maintenanceFailed);
      setStorageFeedbackTone('danger');
    } finally {
      setStorageBusyAction(null);
    }
  };

  const handleBackgroundAudioChange = async (enabled: boolean) => {
    setSoundFeedbackText(enabled ? '正在开启后台提示音...' : '正在关闭后台提示音...');
    setSoundFeedbackTone('muted');
    try {
      await onUpdateSettings({ backgroundAudio: enabled });
      setSoundFeedbackText(
        enabled
          ? '后台提示音已开启，下一次真实告警会自动播放当前提示音。'
          : '后台提示音已关闭，真实告警只会记录和弹通知，不会自动响铃。',
      );
      setSoundFeedbackTone(enabled ? 'success' : 'warning');
    } catch {
      setSoundFeedbackText('保存后台提示音开关失败，请稍后再试。');
      setSoundFeedbackTone('danger');
    }
  };

  const handleImportCityMap = async () => {
    setCityMapBusy(true);
    setCityMapFeedbackText('正在导入示例城市映射...');
    setCityMapFeedbackTone('muted');
    try {
      const imported = await onImportCityMap(SAMPLE_CITY_MAP_LINES);
      if (imported > 0) {
        setCityMapFeedbackText(`已导入 ${imported} 条示例城市映射，盘口数据已同步刷新。`);
        setCityMapFeedbackTone('success');
      } else {
        setCityMapFeedbackText('本次示例城市映射没有新增变化；当前示例只覆盖东京和纽约。');
        setCityMapFeedbackTone('warning');
      }
    } catch {
      setCityMapFeedbackText('导入失败，请稍后再试。');
      setCityMapFeedbackTone('danger');
    } finally {
      setCityMapBusy(false);
    }
  };

  const updateRule = (ruleId: string, patch: Partial<AlertRule>) => {
    markPreviewStale();
    const nextRules = normalizeRuleDrafts(
      normalizedRules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
    );
    setDraftRules(nextRules);
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
      setPreviewResult(null);
      return;
    }

    setPreviewBusy(true);
    try {
      const result = await onPreviewRule(selectedRule);
      setPreviewText(RULE_PAGE_TEXT.previewResult(result.matchedCityCount, result.matchedMarketCount));
      setPreviewResult(result);
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message : '预览失败';
      setPreviewText(message);
      setPreviewResult(null);
    } finally {
      setPreviewBusy(false);
    }
  };

  const clearFilters = () => {
    setQuery('');
    setSourceFilter('all');
    setEnabledFilter('all');
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
    setPreviewResult(null);
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

        {isQuietHoursActive ? (
          <section className="rule-quiet-warning">
            <strong>当前处于安静时段，只会静音通知和声音</strong>
            <span>
              当前安静时段为 {settings.quietHoursStart} - {settings.quietHoursEnd}
              。规则命中仍会记录到告警中心，系统弹窗和提示音会暂时停用。
            </span>
          </section>
        ) : null}

        {runtimeIssues.length > 0 ? (
          <section className="rule-runtime-warning" role="alert" aria-label="runtime-diagnostics">
            <div className="rule-runtime-warning__head">
              <div>
                <strong>当前运行存在需要处理的问题</strong>
                <span>启动失败、worker 未在线、最近操作失败或数据文件缺失都会在这里直接展示。</span>
              </div>
            </div>
            <div className="settings-readiness-panel">
              {runtimeIssues.map((issue) => (
                <article key={issue.id} className={`settings-readiness-card is-${issue.tone}`}>
                  <span>{issue.sourceLabel}</span>
                  <strong>{issue.title}</strong>
                  <p>{issue.detail}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}

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
              </div>
            </section>

            <details className="rules-filter-details">
              <summary>
                <span>{RULE_FILTER_PANEL_TEXT.advancedTitle}</span>
                <small>{RULE_FILTER_PANEL_TEXT.advancedHint}</small>
              </summary>

              <div className="rules-filter-selects">
                <label className="field">
                  <span>{RULE_PAGE_TEXT.source}</span>
                  <select
                    value={sourceFilter}
                    onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
                  >
                    {SOURCE_FILTERS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

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
            </details>
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

          {selectedRuleHiddenByFilters ? (
            <div className="rules-selection-notice" role="status">
              当前选中的规则被筛选器隐藏了，你仍然在编辑它；清空筛选后会重新出现在列表里。
            </div>
          ) : null}
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
                {previewResult?.sampleMarkets?.length ? (
                  <ul className="rule-preview-samples">
                    {previewResult.sampleMarkets.map((row) => (
                      <li key={`${row.marketId}-${row.side}`}>
                        <strong>{formatPreviewSampleLabel(row)}</strong>
                        <span>{formatPreviewSampleQuote(row)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
              <article
                className={`rule-action-card ${hasUnsavedChanges ? 'is-warning' : 'is-success'}`}
              >
                <span className="rule-action-card__label">{RULE_ACTION_PANEL_TEXT.draftTitle}</span>
                <strong>{draftFeedbackTitle}</strong>
                <p>{saveStatusText}</p>
              </article>
            </div>
            <section className={`rule-diagnostic-panel is-${ruleDiagnostic.tone}`}>
              <div className="rule-diagnostic-panel__head">
                <span>触发诊断</span>
                <strong>{ruleDiagnostic.title}</strong>
                <p>{ruleDiagnostic.summary}</p>
              </div>
              <div className="rule-diagnostic-panel__steps">
                {ruleDiagnostic.items.map((item) => (
                  <div key={item.label} className={`rule-diagnostic-step is-${item.tone}`}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <p>{item.hint}</p>
                  </div>
                ))}
              </div>
            </section>
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

                  </div>
                </section>

                <section className="rule-editor-section">
                  <div className="rule-editor-section__head">
                    <strong>{RULE_EDITOR_SECTION_TEXT.trigger.title}</strong>
                    <span>{RULE_EDITOR_SECTION_TEXT.trigger.hint}</span>
                  </div>

                  {selectedTriggerGuide ? (
                    <div className="rule-trigger-guide">
                      <div className="rule-trigger-guide__summary">
                        <span>当前触发逻辑</span>
                        <strong>{selectedTriggerGuide.title}</strong>
                        <p>{selectedTriggerGuide.summary}</p>
                      </div>
                      <div className="rule-trigger-guide__items">
                        {selectedTriggerGuide.items.map((item) => (
                          <div key={item.label}>
                            <span>{item.label}</span>
                            <strong>{item.value}</strong>
                            <p>{item.hint}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

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
                      <small className="rule-field-hint">选择这条规则要盯住的盘口变化。</small>
                    </label>

                    {selectedRule.metric === 'liquidity_kill' ? (
                      <label className="field">
                        <span>监控盘口</span>
                        <select
                          value={selectedRule.liquiditySide ?? 'both'}
                          onChange={(event) =>
                            updateRule(selectedRule.id, {
                              liquiditySide: event.target.value as NonNullable<AlertRule['liquiditySide']>,
                            })
                          }
                        >
                          {LIQUIDITY_SIDE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <small className="rule-field-hint">
                          买盘指买一侧，卖盘指卖一侧；不是 YES/NO 方向。
                        </small>
                      </label>
                    ) : selectedRule.metric === 'volume_pricing' ? (
                      <label className="field">
                        <span>判断方式</span>
                        <input value="卖一推高幅度" disabled />
                        <small className="rule-field-hint">
                          后台固定按“卖一被推高至少多少美分，并且有量确认”判断，不需要再选大于/小于。
                        </small>
                      </label>
                    ) : (
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
                        <small className="rule-field-hint">
                          {selectedTriggerGuide?.items[1]?.hint ?? '设置实际值和阈值的比较方式。'}
                        </small>
                      </label>
                    )}

                    <label className="field">
                      <span>{RULE_PAGE_TEXT.threshold}</span>
                      <input
                        type="number"
                        step={getRuleThresholdStep(selectedRule.metric)}
                        value={selectedRule.threshold}
                        onChange={(event) =>
                          updateRule(selectedRule.id, {
                            threshold: parseNumberInput(event.target.value, selectedRule.threshold),
                          })
                        }
                      />
                      <small className="rule-field-hint">{selectedTriggerGuide?.thresholdHint}</small>
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
                      <small className="rule-field-hint">
                        用来判断短时间变化，当前为 {formatRuleDuration(selectedRule.windowSec)}。
                      </small>
                    </label>
                  </div>

                  <details className="rule-editor-advanced">
                    <summary>高级触发设置</summary>
                    <div className="rule-editor-section__grid">
                      {selectedRule.metric !== 'liquidity_kill' ? null : (
                        <label className="field">
                          <span>判断方式</span>
                          <input value="不低于最低被清空价位" disabled />
                          <small className="rule-field-hint">
                            新版盘口斩杀固定按“被清空前的价位是否达到最低门槛”判断。
                          </small>
                        </label>
                      )}

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
                        <small className="rule-field-hint">
                          命中后暂停重复提醒，当前为 {formatRuleDuration(selectedRule.cooldownSec)}。
                        </small>
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
                        <small className="rule-field-hint">
                          相同告警在 {formatRuleDuration(selectedRule.dedupeWindowSec)} 内合并。
                        </small>
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
                        <small className="rule-field-hint">只影响总览泡泡风险权重，不影响是否触发。</small>
                      </label>
                    </div>
                  </details>
                </section>

                <section className="rule-editor-section">
                  <div className="rule-editor-section__head">
                    <strong>{RULE_EDITOR_SECTION_TEXT.scope.title}</strong>
                    <span>{RULE_EDITOR_SECTION_TEXT.scope.hint}</span>
                  </div>

                  {selectedScopeGuide ? (
                    <div className={`rule-scope-guide is-${selectedScopeGuide.tone}`}>
                      <div className="rule-scope-guide__summary">
                        <span>监控范围预览</span>
                        <strong>{selectedScopeGuide.title}</strong>
                        <p>{selectedScopeGuide.summary}</p>
                      </div>
                      <div className="rule-scope-guide__items">
                        {selectedScopeGuide.items.map((item) => (
                          <div key={item.label}>
                            <span>{item.label}</span>
                            <strong>{item.value}</strong>
                            <p>{item.hint}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

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
                      <small className="rule-field-hint">
                        选择具体盘口会自动锁定城市、日期、温区和方向；不选则使用下面的范围条件。
                      </small>
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
                      <small className="rule-field-hint">只看某个城市；清空表示全部城市。</small>
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
                      <small className="rule-field-hint">只看某个日期；清空表示全部日期。</small>
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
                      <small className="rule-field-hint">只看某个温度区间；清空表示全部温区。</small>
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
                      <small className="rule-field-hint">选择是或否方向；不选表示双边一起看。</small>
                    </label>
                  </div>
                </section>

                <section className="rule-editor-section">
                  <div className="rule-editor-section__head">
                    <strong>{RULE_EDITOR_SECTION_TEXT.quiet.title}</strong>
                    <span>{RULE_EDITOR_SECTION_TEXT.quiet.hint}</span>
                  </div>

                  <details className="rule-editor-advanced">
                    <summary>高级通知设置</summary>
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
                  </details>
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
                  const listSignal = buildRuleListSignal(rule, marketRows, health);

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

                        <div className={`rule-card__signal is-${listSignal.tone}`}>
                          <div>
                            <span>状态</span>
                            <strong>{listSignal.statusText}</strong>
                          </div>
                          <div>
                            <span>覆盖</span>
                            <strong>{listSignal.coverageText}</strong>
                          </div>
                          <div>
                            <span>当前</span>
                            <strong>{listSignal.hitText}</strong>
                          </div>
                          <p>{listSignal.hint}</p>
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
                onChange={(event) => void handleBackgroundAudioChange(event.target.checked)}
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
              <span>{copy.settings.tickRetention}</span>
              <input
                type="number"
                min={MIN_TICK_RETENTION_DAYS}
                max={MAX_TICK_RETENTION_DAYS}
                step={1}
                value={settings.tickRetentionDays}
                onChange={(event) =>
                  onUpdateSettings({
                    tickRetentionDays: Math.max(
                      MIN_TICK_RETENTION_DAYS,
                      Math.min(
                        MAX_TICK_RETENTION_DAYS,
                        Math.trunc(Number(event.target.value) || DEFAULT_TICK_RETENTION_DAYS),
                      ),
                    ),
                  })
                }
              />
              <small className="rule-field-hint">{copy.settings.tickRetentionHint}</small>
            </label>

            <label className="field">
              <span>{copy.settings.alertRetention}</span>
              <input
                type="number"
                min={MIN_ALERT_RETENTION_DAYS}
                max={MAX_ALERT_RETENTION_DAYS}
                step={1}
                value={settings.alertRetentionDays}
                onChange={(event) =>
                  onUpdateSettings({
                    alertRetentionDays: Math.max(
                      MIN_ALERT_RETENTION_DAYS,
                      Math.min(
                        MAX_ALERT_RETENTION_DAYS,
                        Math.trunc(Number(event.target.value) || DEFAULT_ALERT_RETENTION_DAYS),
                      ),
                    ),
                  })
                }
              />
              <small className="rule-field-hint">{copy.settings.alertRetentionHint}</small>
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
                onChange={(event) => void handlePickSound(event.target.value)}
                disabled={soundBusyAction !== null}
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

          <div className="settings-readiness-panel" aria-label="告警通知状态">
            {notificationStatusItems.map((item) => (
              <div
                key={item.label}
                className={`settings-readiness-card is-${item.tone}`}
              >
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <p>{item.hint}</p>
              </div>
            ))}
          </div>

          <header className="panel__header panel__header--stacked">
            <div>
              <h2>{copy.settings.storageTitle}</h2>
              <span>{copy.settings.storageHint}</span>
            </div>
          </header>

          <div className="settings-storage-panel" aria-label="storage-summary">
            {storageOverviewItems.map((item, index) => (
              <div
                key={item.label}
                className={`settings-readiness-card ${index === 0 ? 'settings-storage-card--primary' : ''} is-${item.tone}`}
              >
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <p>{item.hint}</p>
              </div>
            ))}
          </div>

          <div className="action-row storage-action-row">
            <button
              type="button"
              className="ghost-button ghost-button--primary"
              aria-label="storage-clear-cache"
              onClick={() => void handleClearStorageCache()}
              disabled={storageBusyAction !== null || Boolean(storageClearDisabledReason)}
              title={storageClearDisabledReason ?? undefined}
            >
              {storageBusyAction === 'clear-cache'
                ? copy.settings.storageClearCacheBusy
                : copy.settings.storageClearCache}
            </button>
            <button
              type="button"
              className="ghost-button"
              aria-label="storage-run-maintenance"
              onClick={() => void handleRunStorageMaintenance()}
              disabled={storageBusyAction !== null || isMainDbMissing}
              title={storageBackupDisabledReason ?? undefined}
            >
              {storageBusyAction === 'maintenance'
                ? storageText.maintenanceBusy
                : storageText.maintenanceButton}
            </button>
            <button
              type="button"
              className="ghost-button"
              aria-label="storage-create-backup"
              onClick={() => void handleCreateStorageBackup()}
              disabled={storageBusyAction !== null || isMainDbMissing}
              title={storageBackupDisabledReason ?? undefined}
            >
              {storageBusyAction === 'backup'
                ? copy.settings.storageCreateBackupBusy
                : copy.settings.storageCreateBackup}
            </button>
            <button
              type="button"
              className="ghost-button"
              aria-label="storage-create-diagnostics"
              onClick={() => void handleCreateDiagnosticsPackage()}
              disabled={storageBusyAction !== null}
            >
              {storageBusyAction === 'diagnostics'
                ? storageText.diagnosticsBusy
                : storageText.diagnosticsButton}
            </button>
          </div>
          <p className={`rule-settings-feedback is-${resolvedStorageFeedbackTone}`} role="status">
            {resolvedStorageFeedbackText}
          </p>

          <details className="storage-technical-details">
            <summary>{copy.settings.storageTechnicalDetails}</summary>
            <p className="rule-hint">{copy.settings.storageTechnicalDetailsHint}</p>
            <div className="storage-technical-list">
              {storageTechnicalItems.map((item) => (
                <div key={item.label} className="storage-technical-item">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
            {latestMainBackupPath ? (
              <p className="rule-hint">{latestMainBackupPath}</p>
            ) : null}
          </details>

          <div className="action-row">
            <button
              type="button"
              className="ghost-button"
              onClick={() => void handlePreviewSound()}
              disabled={!selectedSoundProfile || soundBusyAction !== null}
            >
              {soundBusyAction === 'preview' ? '正在试听...' : RULE_PAGE_TEXT.previewSound}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void handleRegisterSound()}
              disabled={!selectedSoundProfile || soundBusyAction !== null}
            >
              {soundBusyAction === 'register' ? '正在登记...' : RULE_PAGE_TEXT.registerSound}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void handleImportCityMap()}
              disabled={cityMapBusy}
            >
              {cityMapBusy ? '正在导入...' : RULE_PAGE_TEXT.importCityMap}
            </button>
          </div>
          <p className={`rule-settings-feedback is-${soundFeedbackTone}`} role="status">
            {soundFeedbackText}
          </p>
          <p className={`rule-settings-feedback is-${cityMapFeedbackTone}`} role="status">
            {cityMapFeedbackText}
          </p>
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
