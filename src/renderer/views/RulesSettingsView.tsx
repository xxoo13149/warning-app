import { useEffect, useMemo, useRef, useState } from 'react';

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
  AlertRule as ContractAlertRule,
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
  type AlertRule,
  buildRuleConditionSummary,
  formatLiquiditySideLabel,
  formatRuleDuration,
  formatRuleMetricLabel,
  formatRuleOperatorLabel,
  formatRuleSourceLabel,
  normalizeRuleDrafts,
  quietHoursDraftToValue,
  quietHoursToDraft,
  type RuleQuietHoursDraft,
} from '../utils/rules-settings';

const SAMPLE_CITY_MAP_LINES = ['tokyo,RJTT,Asia/Tokyo', 'nyc,KNYC,America/New_York'];

type SettingsFeedbackTone = 'muted' | 'success' | 'warning' | 'danger';

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

interface RuleListSignal {
  tone: SettingsFeedbackTone;
  statusText: string;
  coverageText: string;
  hitText: string;
  hint: string;
}

interface RulesSettingsViewProps {
  rules: ContractAlertRule[];
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
  onPreviewRule: (rule: ContractAlertRule) => Promise<RulePreviewResult>;
  onSaveRules: (nextRules: ContractAlertRule[]) => void;
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

const RULE_PAGE_TEXT = {
  search: '搜索规则',
  searchPlaceholder: '输入规则名、指标或触发条件',
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
const RULE_FILTER_PANEL_TEXT = {
  step: '第一步',
  title: '先筛选规则',
  hint: '按来源、状态、关键词和指标缩小范围，再选择要调整的规则。',
  commonTitle: '基础筛选',
  commonHint: '先用常用条件快速定位。',
  advancedTitle: '精确筛选',
  advancedHint: '需要更准时，再限定来源和指标。',
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
const RULE_EDITOR_DIALOG_TEXT = {
  eyebrow: '修改规则',
  liveHint: '修改会立即生效，点空白处也可以关闭。',
  previewTitle: '预览结果',
  previewIdle: '暂无预览结果',
  previewBusy: '正在预览',
  previewDone: '最近预览',
  previewStale: '预览需更新',
  previewStaleHint: '设置已修改，请重新预览。',
};

const STORAGE_CLEAR_RECOMMENDATION_HIGH_BYTES = 512 * 1024 * 1024;

type SourceFilter = (typeof SOURCE_FILTERS)[number]['value'];
type EnabledFilter = (typeof ENABLED_FILTERS)[number]['value'];
type MetricFilter = 'all' | AlertRule['metric'];

const cleanText = (value?: string | null) => value?.trim() ?? '';

const METRIC_OPTIONS: AlertRule['metric'][] = [
  'price',
  'change5m',
  'spread',
  'liquidity_kill',
  'volume_pricing',
  'abnormal_lottery',
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

const countRules = (rules: AlertRule[], predicate: (rule: AlertRule) => boolean) =>
  rules.reduce((total, rule) => (predicate(rule) ? total + 1 : total), 0);

const buildRulesSyncToken = (rules: AlertRule[]) => JSON.stringify(rules);

const buildRuleSearchText = (rule: AlertRule) =>
  [
    rule.name,
    formatRuleSourceLabel(rule),
    formatRuleMetricLabel(rule.metric),
    buildRuleConditionSummary(rule),
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

const hasAbnormalLotterySignal = (row: MarketRow) =>
  row.lotteryCandidate === true && (row.lotteryLift ?? 0) > 0;

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

const formatScopeSideText = (side?: AlertRule['scope']['side']) => {
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

const ABNORMAL_LOTTERY_ROUTE_HINT = '1-2c -> 3c, 3-4c -> 4c';

const getRuleCurrentValue = (rule: AlertRule, row: MarketRow) => {
  switch (rule.metric) {
    case 'price':
      return row.yesPrice;
    case 'change5m':
      return row.change5m;
    case 'spread':
    case 'bidask_gap':
      return row.spread;
    case 'abnormal_lottery':
      return row.lotteryCurrentAsk ?? row.bestAsk ?? null;
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
    case 'abnormal_lottery':
      return formatCentsText(value);
    case 'price':
    case 'liquidity_kill':
    case 'volume_pricing':
    default:
      return formatCentsText(value);
  }
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
      return '监控短窗口内买盘或卖盘该侧现价盘口是否被清空，这是一个事件型规则，不是静态价格阈值。';
    case 'volume_pricing':
      return '监控卖一是否在短窗口内被明显推高，并且有成交或盘口量确认。';
    case 'abnormal_lottery':
      return '监控超低价盘口是否出现异常彩票候选，并拿到成交、旧档被吃或盘口深度确认。';
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
      return '填写“该侧现价盘口被清空前的最低价位”，例如 0.2 表示只有清空 20 美分及以上的现价盘口才提醒。';
    case 'volume_pricing':
      return '填写“卖一被推高的最小幅度”，例如 0.1 表示至少推高 10 美分才提醒。';
    case 'abnormal_lottery':
      return '填写“最低确认终点价位”，例如 0.03 表示至少看到卖一被推到 3c；若参考卖一本就在 3-4c，系统仍会看 4c 确认。';
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
  if (rule.metric === 'abnormal_lottery') {
    return {
      title: buildRuleConditionSummary(rule),
      summary: getRuleMetricPlainText(rule.metric),
      thresholdHint: getRuleThresholdHint(rule.metric),
      items: [
        {
          label: '监控指标',
          value: formatRuleMetricLabel(rule.metric),
          hint: '它看的不是单独的 Market Explorer 模式，而是市场本身是否打上异常彩票上下文。',
        },
        {
          label: '触发路线',
          value: ABNORMAL_LOTTERY_ROUTE_HINT,
          hint: '先满足超低价 route，再结合成交、旧档被吃或盘口深度这类 confirmation source。',
        },
        {
          label: '最低确认终点',
          value: formatRuleValue(rule, rule.threshold),
          hint: getRuleThresholdHint(rule.metric),
        },
        {
          label: '观察窗口',
          value: formatRuleDuration(rule.windowSec),
          hint: `后台会在 ${formatRuleDuration(rule.windowSec)} 内把参考卖一、当前卖一和 confirmation source 串起来。`,
        },
      ],
    };
  }

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
          hint: '新版盘口斩杀看的是“买盘/卖盘该侧现价盘口被清空”这个事件，不是当前价格还剩多少。',
        },
        {
          label: '监控盘口',
          value: formatLiquiditySideLabel(rule.liquiditySide),
          hint: '买盘=买一侧现价盘口，卖盘=卖一侧现价盘口；如果选买卖两边，只要任意一侧现价盘口被清空就会判断。',
        },
        {
          label: '最低清空前价位',
          value: formatRuleValue(rule, rule.threshold),
          hint: getRuleThresholdHint(rule.metric),
        },
        {
          label: '观察窗口',
          value: formatRuleDuration(rule.windowSec),
          hint: `后台会在 ${formatRuleDuration(rule.windowSec)} 的窗口里看是否发生该侧现价盘口被清空，再叠加冷却和去重控制重复提醒。`,
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

  if (rule.metric === 'abnormal_lottery') {
    if (scopedRows.length === 0) {
      return {
        tone: 'warning',
        statusText: '已启用',
        coverageText: '0 个盘口',
        hitText: '等待候选',
        hint: '当前还没有可评估的盘口数据，系统暂时抓不到异常彩票候选。',
      };
    }

    const lotteryRows = scopedRows.filter((row) => hasAbnormalLotterySignal(row));
    const confirmedRows = lotteryRows.filter((row) => Boolean(row.lotteryConfirmationSource));

    return {
      tone: confirmedRows.length > 0 ? 'success' : lotteryRows.length > 0 ? 'muted' : 'muted',
      statusText: '已启用',
      coverageText: `${scopedRows.length} 个盘口`,
      hitText:
        confirmedRows.length > 0
          ? `${confirmedRows.length} 个确认`
          : lotteryRows.length > 0
            ? `${lotteryRows.length} 个候选`
            : '等待候选',
      hint:
        confirmedRows.length > 0
          ? `已看到 ${confirmedRows.length} 个异常彩票确认；可回到 Market Explorer 查看 badge、route 和 confirmation 细节。`
          : lotteryRows.length > 0
            ? `当前已有 ${lotteryRows.length} 个超低价候选，系统会继续等 confirmation source。`
            : `当前暂未出现异常彩票候选；重点关注超低价 route ${ABNORMAL_LOTTERY_ROUTE_HINT}。`,
    };
  }

  if (rule.metric === 'volume_pricing') {
    if (scopedRows.length === 0) {
      return {
        tone: 'warning',
        statusText: '已启用',
        coverageText: '0 个盘口',
        hitText: '按事件判断',
        hint: '当前还没有可评估的盘口数据，后台暂时抓不到带量定价事件。',
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
        hint: '当前还没有可评估的盘口数据，后台暂时抓不到该侧现价盘口被清空的事件。',
      };
    }

    return {
      tone: 'muted',
      statusText: '已启用',
      coverageText: `${scopedRows.length} 个盘口`,
      hitText: '事件型规则',
      hint: `监控 ${formatLiquiditySideLabel(rule.liquiditySide)} 的现价盘口是否会在 ${formatRuleDuration(rule.windowSec)} 内被清空；当前买一卖一只用来辅助预览。`,
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
      hint: '当前还没有可评估的盘口数据，等市场数据加载后再看。',
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
        : '当前已有盘口参与评估，但还没有达到触发条件。',
  };
};

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
  const stripRuleScope = (rule: AlertRule): AlertRule => ({
    ...rule,
    scope: {},
  });
  const initialRules = normalizeRuleDrafts(rules).map(stripRuleScope);
  const [draftRules, setDraftRules] = useState<AlertRule[]>(() => initialRules);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>('all');
  const [metricFilter, setMetricFilter] = useState<MetricFilter>('all');
  const [selectedRuleId, setSelectedRuleId] = useState<string>('');
  const [isRuleEditorOpen, setIsRuleEditorOpen] = useState(false);
  const [previewText, setPreviewText] = useState(RULE_PAGE_TEXT.previewEmpty);
  const [previewResult, setPreviewResult] = useState<RulePreviewResult | null>(null);
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
  const hasLocalRuleDraftChangesRef = useRef(false);
  const isQuietHoursActive = isCurrentTimeInQuietHours(
    settings.quietHoursStart,
    settings.quietHoursEnd,
  );
  const draftRulesSyncToken = useMemo(() => buildRulesSyncToken(draftRules), [draftRules]);

  useEffect(() => {
    const nextRules = normalizeRuleDrafts(rules).map(stripRuleScope);
    const nextRulesSyncToken = buildRulesSyncToken(nextRules);

    if (nextRulesSyncToken === draftRulesSyncToken) {
      hasLocalRuleDraftChangesRef.current = false;
      return;
    }

    if (isRuleEditorOpen || hasLocalRuleDraftChangesRef.current) {
      return;
    }

    setDraftRules(nextRules);
  }, [draftRulesSyncToken, isRuleEditorOpen, rules]);

  const normalizedRules = useMemo(
    () => normalizeRuleDrafts(draftRules).map(stripRuleScope),
    [draftRules],
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
      if (keyword && !buildRuleSearchText(rule).includes(keyword)) {
        return false;
      }
      return true;
    });
  }, [enabledFilter, marketRows, metricFilter, normalizedRules, query, sourceFilter]);

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

  const selectedRule = normalizedRules.find((rule) => rule.id === selectedRuleId) ?? null;
  const selectedQuietDraft = selectedRule ? quietHoursToDraft(selectedRule.quietHours) : null;

  useEffect(() => {
    setPreviewText(RULE_PAGE_TEXT.previewEmpty);
    setPreviewResult(null);
  }, [selectedRuleId]);

  useEffect(() => {
    if (!isRuleEditorOpen || selectedRule) {
      return;
    }
    setIsRuleEditorOpen(false);
  }, [isRuleEditorOpen, selectedRule]);

  useEffect(() => {
    if (!isRuleEditorOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      setIsRuleEditorOpen(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isRuleEditorOpen]);
  const selectedRuleHiddenByFilters =
    Boolean(selectedRule) && !visibleRules.some((rule) => rule.id === selectedRuleId);
  const selectedTriggerGuide = selectedRule ? buildRuleTriggerGuide(selectedRule) : null;
  const previewFeedbackTitle = previewBusy
    ? RULE_EDITOR_DIALOG_TEXT.previewBusy
    : previewText === RULE_PAGE_TEXT.previewEmpty
      ? RULE_EDITOR_DIALOG_TEXT.previewIdle
      : previewText === RULE_EDITOR_DIALOG_TEXT.previewStaleHint
        ? RULE_EDITOR_DIALOG_TEXT.previewStale
        : RULE_EDITOR_DIALOG_TEXT.previewDone;
  const previewFeedbackTone =
    previewBusy
      ? 'is-active'
      : previewText === RULE_PAGE_TEXT.previewEmpty
        ? 'is-muted'
        : previewText === RULE_EDITOR_DIALOG_TEXT.previewStaleHint
          ? 'is-warning'
          : previewText.includes('失败')
            ? 'is-danger'
            : 'is-info';

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
    metricFilter !== 'all';

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
  ].filter((value): value is string => Boolean(value));

  const markPreviewStale = () => {
    if (previewText !== RULE_PAGE_TEXT.previewEmpty) {
      setPreviewText(RULE_EDITOR_DIALOG_TEXT.previewStaleHint);
    }
    setPreviewResult(null);
  };

  const commitRules = (nextRules: AlertRule[]) => {
    const normalizedNextRules = normalizeRuleDrafts(nextRules).map(stripRuleScope);
    hasLocalRuleDraftChangesRef.current = true;
    setDraftRules(normalizedNextRules);
    onSaveRules(normalizedNextRules as ContractAlertRule[]);
  };

  const openRuleEditor = (ruleId: string) => {
    setSelectedRuleId(ruleId);
    setIsRuleEditorOpen(true);
  };

  const closeRuleEditor = () => {
    setIsRuleEditorOpen(false);
  };

  const updateRuleQuietHours = (ruleId: string, quietHours: AlertRule['quietHours']) => {
    markPreviewStale();
    const nextRules = normalizeRuleDrafts(
      normalizedRules.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              quietHours,
            }
          : rule,
      ),
    );
    commitRules(nextRules);
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
    commitRules(nextRules);
  };

  const handlePreviewFirstRule = async () => {
    if (!selectedRule) {
      setPreviewText(RULE_PAGE_TEXT.noSelectedRule);
      setPreviewResult(null);
      return;
    }

    setPreviewBusy(true);
    try {
      const result = await onPreviewRule(selectedRule as ContractAlertRule);
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
              <h3>筛选规则</h3>
              <p>按关键词、来源、状态和范围快速定位目标规则。</p>
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

          <section className="rules-list-panel">
            <div className="rules-list-panel__head">
              <div>
                <h3>规则列表</h3>
                <p>点一下卡片就会弹出修改窗口；启用和停用仍然会立刻生效。</p>
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
                  const latestAlertAt = latestAlertAtByRuleId[rule.id];

                  return (
                    <article
                      key={rule.id}
                      className={`rule-card ${isSelected ? 'is-selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openRuleEditor(rule.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openRuleEditor(rule.id);
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
                            <span>最近告警</span>
                            <strong>
                              {latestAlertAt ? formatDateTimeText(latestAlertAt) : '暂无'}
                            </strong>
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

          {isRuleEditorOpen && selectedRule ? (
            <div className="rule-editor-dialog">
              <div
                className="rule-editor-dialog__backdrop"
                data-testid="rule-editor-backdrop"
                onClick={closeRuleEditor}
              />
              <section
                className="rule-editor-dialog__surface"
                role="dialog"
                aria-modal="true"
                aria-labelledby={`rule-editor-title-${selectedRule.id}`}
              >
                <header className="rule-editor-dialog__header">
                  <div className="rule-editor-dialog__title">
                    <p className="rule-editor-dialog__eyebrow">{RULE_EDITOR_DIALOG_TEXT.eyebrow}</p>
                    <h3 id={`rule-editor-title-${selectedRule.id}`}>{selectedRule.name}</h3>
                    <p>{buildRuleConditionSummary(selectedRule)}</p>
                    <p className="rule-editor-dialog__meta">{RULE_EDITOR_DIALOG_TEXT.liveHint}</p>
                  </div>
                  <div className="rule-editor-dialog__actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => void handlePreviewFirstRule()}
                      disabled={previewBusy}
                    >
                      {previewBusy ? RULE_EDITOR_DIALOG_TEXT.previewBusy : RULE_PAGE_TEXT.previewSelected}
                    </button>
                    <button
                      type="button"
                      className="rule-editor-dialog__close"
                      aria-label="close-rule-editor"
                      onClick={closeRuleEditor}
                    >
                      关闭
                    </button>
                  </div>
                </header>

                <div className="rule-editor-dialog__body">
                  <section className={`rule-action-card ${previewFeedbackTone}`}>
                    <span className="rule-action-card__label">{RULE_EDITOR_DIALOG_TEXT.previewTitle}</span>
                    <strong>{previewFeedbackTitle}</strong>
                    <p>
                      {previewBusy
                        ? '正在计算这条规则当前会命中的城市和盘口。'
                        : previewText === RULE_PAGE_TEXT.previewEmpty
                          ? '需要时可以先预览影响，再决定是否继续微调阈值和窗口。'
                          : previewText === RULE_EDITOR_DIALOG_TEXT.previewStaleHint
                            ? '刚刚改过字段，建议重新预览一次，确认实际覆盖面。'
                            : previewText}
                    </p>
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
                  </section>

                  <section className="rule-editor-layout__form">
                    <div className="rule-editor-layout__section-head">
                      <strong>规则详情</strong>
                      <span>{formatRuleSourceLabel(selectedRule)}</span>
                    </div>
                    <p className="control-progress__text">修改后会立即生效，不需要再单独保存。</p>

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
                                买盘指买一侧现价盘口，卖盘指卖一侧现价盘口；不是 YES/NO 方向。
                              </small>
                            </label>
                          ) : selectedRule.metric === 'volume_pricing' ||
                            selectedRule.metric === 'abnormal_lottery' ? (
                            <label className="field">
                              <span>判断方式</span>
                              <input
                                value={selectedRule.metric === 'abnormal_lottery' ? '超低价 route 确认' : '卖一推高幅度'}
                                disabled
                              />
                              <small className="rule-field-hint">
                                {selectedRule.metric === 'abnormal_lottery'
                                  ? '前端固定按异常彩票 route 和 confirmation source 引导，不再单独选择大于/小于。'
                                  : '后台固定按“卖一被推高至少多少美分，并且有量确认”判断，不需要再选大于/小于。'}
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
                                <input value="不低于最低清空前价位" disabled />
                                <small className="rule-field-hint">
                                  新版盘口斩杀固定按“该侧现价盘口被清空前的价位是否达到最低门槛”判断。
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
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </section>

      <section className="workspace-grid workspace-grid--wide">
        <section className="panel panel--settings">
          <header className="panel__header">
            <div>
              <h2>{copy.settings.settingsTitle}</h2>
              <span>{copy.settings.settingsHint}</span>
            </div>
          </header>

          <div className="settings-panel__body">

          <div className="settings-panel__section">
            <div className="settings-panel__section-head">
              <strong>运行偏好</strong>
              <p>启动方式、刷新节奏、安静时段和默认提示音都在这里统一调整。</p>
            </div>

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
              <p className="rule-hint">这里的提示音、通知和城市映射会影响全部规则。</p>
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

          </div>

          <div className="settings-panel__section">
            <div className="settings-panel__section-head">
              <strong>{copy.settings.storageTitle}</strong>
              <p>{copy.settings.storageHint}</p>
            </div>

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

          </div>

          <div className="settings-panel__section settings-panel__section--compact">
            <div className="settings-panel__section-head">
              <strong>辅助操作</strong>
              <p>试听、登记当前提示音，以及导入示例城市映射。</p>
            </div>

          <div className="action-row settings-panel__actions">
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
          </div>
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
