import { memo, startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '../i18n';
import { cn } from '../lib/tailwind-utils';
import type {
  AlertEvent,
  AppLanguage,
  MarketQuery,
  MarketRow,
  OrderSide,
} from '../types/contracts';
import {
  formatMarketCentsLabel,
  formatMarketPercent,
  formatTemperatureBandLabel,
  hasMarketQuoteSignal,
} from '../utils/market-display';
import {
  buildAlertSummaryDraft,
  type AlertFact,
} from '../utils/alert-summary';

interface MarketExplorerViewProps {
  rows: MarketRow[];
  total: number;
  query: MarketQuery;
  focusMarketId?: string | null;
  focusAlert?: AlertEvent | null;
  onQueryChange: (next: Partial<MarketQuery>) => void;
  onRefresh: () => void;
}

interface MarketExplorerRowProps {
  row: MarketRow;
  formatTime: (value: string) => string;
  language: AppLanguage;
  selected: boolean;
  alertFocused?: boolean;
  alertDriven?: boolean;
  alertTriggerLabel?: string | null;
  focusedColumn?: PrecisionFocusColumn;
  focusReferenceValue?: number | null;
  onSelect: (marketId: string) => void;
}

interface MarketBandProps {
  row: MarketRow;
  formatTime: (value: string) => string;
  language: AppLanguage;
  selected: boolean;
  onSelect: (marketId: string) => void;
}

interface AlertFactListProps {
  title: string;
  items: AlertFact[];
  accent?: 'highlight' | 'muted';
}

interface InspectorSignalCardProps {
  title: string;
  label: string;
  value: string;
}

interface InspectorCompareCardProps {
  title: string;
  leftLabel: string;
  leftValue: string;
  rightLabel: string;
  rightValue: string;
  detail?: string | null;
  leftShare?: number | null;
  emphasis?: 'default' | 'primary';
}

interface AlertTriggerStep {
  label: string;
  value: string;
}

interface AlertTriggerRail {
  title: string;
  actualLabel: string;
  actualValue: string;
  thresholdLabel: string;
  thresholdValue: string;
  deltaLabel: string;
  deltaValue: string;
  share: number | null;
  direction: 'above' | 'below' | 'touch';
}

interface AlertThresholdSnapshot {
  actualValue: string;
  thresholdValue: string;
  deltaValue: string;
  share: number | null;
  direction: AlertTriggerRail['direction'];
}

interface AlertTriggerEvidence {
  visualMeta: ReturnType<typeof getAlertRuleVisualMeta>;
  primaryFact: AlertFact | null;
  actual: number | null | undefined;
  threshold: number | null | undefined;
  thresholdSnapshot: AlertThresholdSnapshot | null;
  alertMarketLabel: string;
  selectedMarketLabel: string;
  ruleLabel: string;
  primarySignalValue: string;
  rowTriggerLabel: string;
}

interface AlertTriggerHighlight {
  headline: string;
  summary: string;
  metrics: Array<{ label: string; value: string }>;
  flowTitle: string;
  flowCaption: string;
  flowSteps: AlertTriggerStep[];
  rail: AlertTriggerRail | null;
}

interface TemperatureKillStory {
  active: boolean;
  title: string;
  killedBand: string | null;
  confirmationBand: string | null;
  killedMarketId: string;
  confirmationMarketId: string | null;
  priceRoute: string | null;
  previousPrice: string | null;
  currentPrice: string | null;
  directionLabel: string;
  windowLabel: string | null;
  sourceLabel: string;
  inferenceNote: string;
  ladderRows: Array<{
    marketId: string;
    band: string;
    bid: string;
    ask: string;
    yes: string;
    selected: boolean;
    confirmation: boolean;
  }>;
}

interface PrecisionFocusGuideFact {
  key: 'market' | 'actual' | 'threshold' | 'trigger' | 'scope' | 'compare' | 'context';
  label: string;
  value: string;
  actionLabel?: string;
  actionMarketId?: string;
}

interface PrecisionFocusGuide {
  column: Exclude<PrecisionFocusColumn, null>;
  mode: 'alert' | 'compare';
  title: string;
  summary: string;
  facts: PrecisionFocusGuideFact[];
  rail: AlertTriggerRail | null;
}

interface PrecisionJudgementContextFact {
  key: string;
  label: string;
  value: string;
}

interface PrecisionJudgementPanelData {
  column: Exclude<PrecisionFocusColumn, null>;
  mode: 'alert' | 'compare';
  selectedMarketId: string;
  headline: string;
  summary: string;
  leadFacts: PrecisionFocusGuideFact[];
  contextFacts: PrecisionJudgementContextFact[];
  contextSummary: string;
  actionLabel: string | null;
  actionMarketId: string | null;
  rail: AlertTriggerRail | null;
}

interface PrecisionJudgementSource {
  column: Exclude<PrecisionFocusColumn, null>;
  mode: 'alert' | 'compare';
  selectedMarketId: string | null;
  focusLabel: string;
  focusTitle: string;
  focusSummary: string;
  leadFacts: PrecisionFocusGuideFact[];
  guideFacts: PrecisionFocusGuideFact[];
  contextFacts: PrecisionJudgementContextFact[];
  contextSummary: string;
  actionLabel: string | null;
  actionMarketId: string | null;
  rail: AlertTriggerRail | null;
}

interface PrecisionJudgementPanelProps {
  panel: PrecisionJudgementPanelData;
  onSelectMarket: (marketId: string) => void;
}

type MarketExplorerMode = 'overview' | 'precise';
type MarketSideFilter = '' | Extract<OrderSide, 'YES' | 'NO'>;
type MarketExplorerPreset = 'all' | 'watchlist';
type PrecisionFocusColumn = 'yesPrice' | 'bid' | 'ask' | 'spread' | 'change5m' | 'lottery' | 'updated' | null;

const MARKET_STATUS_LABELS: Record<MarketRow['status'], string> = {
  active: '交易中',
  halted: '已暂停',
  resolved: '已结算',
};

const MARKET_SEVERITY_LABELS: Record<MarketRow['bubbleSeverity'], string> = {
  none: '稳定',
  info: '提示',
  warning: '预警',
  critical: '高风险',
};

const MARKET_SIDE_LABELS: Record<MarketSideFilter, string> = {
  '': '全部方向',
  YES: '是',
  NO: '否',
};

const DEFAULT_SORT_BY: NonNullable<MarketQuery['sortBy']> = 'updatedAt';
const DEFAULT_SORT_DIR: NonNullable<MarketQuery['sortDir']> = 'desc';
const OVERVIEW_CITY_GROUP_LIMIT = 8;
const OVERVIEW_MARKETS_PER_CITY_LIMIT = 6;
const PRECISION_TABLE_ROW_LIMIT = 80;
const SEVERITY_WEIGHT: Record<MarketRow['bubbleSeverity'], number> = {
  critical: 3,
  warning: 2,
  info: 1,
  none: 0,
};

const marketHasWideSpread = (row: MarketRow) => (row.spread ?? 0) >= 0.05;
const marketHasLotterySignal = (row: MarketRow) => row.lotteryCandidate === true && (row.lotteryLift ?? 0) > 0;

const LOTTERY_SOURCE_LABELS: Record<
  NonNullable<MarketRow['lotteryConfirmationSource']>,
  { zh: string; en: string }
> = {
  edge_volume: {
    zh: '卖一旧档被吃掉',
    en: 'Edge volume lifted',
  },
  trade_confirmed: {
    zh: '成交确认',
    en: 'Trade confirmed',
  },
  book_depth: {
    zh: '盘口深度确认',
    en: 'Book depth',
  },
};

const formatSortOptionLabel = (
  sortBy: NonNullable<MarketQuery['sortBy']>,
  language: AppLanguage,
  sortByLabel: (key: 'volume24h' | 'change5m' | 'spread' | 'updatedAt') => string,
) => sortByLabel(sortBy);

const formatLotteryLiftLabel = (value: number | null | undefined, language: AppLanguage) => {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return '--';
  }

  return `+${formatMarketCentsLabel(value, { compact: true }, language)}`;
};

const formatLotteryRouteLabel = (row: MarketRow, language: AppLanguage) => {
  if (
    row.lotteryReferenceAsk === null ||
    row.lotteryReferenceAsk === undefined ||
    row.lotteryCurrentAsk === null ||
    row.lotteryCurrentAsk === undefined
  ) {
    return null;
  }

  return `${formatMarketCentsLabel(row.lotteryReferenceAsk, { compact: true }, language)} -> ${formatMarketCentsLabel(
    row.lotteryCurrentAsk,
    { compact: true },
    language,
  )}`;
};

const formatLotterySourceLabel = (
  source: MarketRow['lotteryConfirmationSource'],
  language: AppLanguage,
) => {
  if (!source) {
    return language === 'zh-CN' ? '待确认' : 'Pending';
  }

  const meta = LOTTERY_SOURCE_LABELS[source];
  if (!meta) {
    return source;
  }

  return language === 'zh-CN' ? meta.zh : meta.en;
};

const formatLotterySizeLabel = (value: number | null | undefined, language: AppLanguage) => {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return '--';
  }

  const displayValue =
    value >= 1000 ? Math.round(value).toLocaleString(language) : Number(value.toFixed(2)).toLocaleString(language);
  return language === 'zh-CN' ? `${displayValue} 份` : `${displayValue} shares`;
};

const formatLotteryNotionalLabel = (value: number | null | undefined, language: AppLanguage) => {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return '--';
  }

  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
};

const isTemperatureLadderKillAlert = (alert: AlertEvent | null | undefined) =>
  alert?.messageKey === 'liquidity_kill' &&
  (alert.messageParams?.source === 'temperature_ladder' ||
    alert.messageParams?.reason === 'temperature_ladder_high' ||
    alert.messageParams?.reason === 'temperature_ladder_low');

const isFiniteMetric = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clampShare = (value: number) => Math.min(0.92, Math.max(0.08, value));

const buildMetricShare = (
  leftValue: number | null | undefined,
  rightValue: number | null | undefined,
) => {
  if (!isFiniteMetric(leftValue) || !isFiniteMetric(rightValue)) {
    return null;
  }

  const total = Math.abs(leftValue) + Math.abs(rightValue);
  if (total <= 0) {
    return 0.5;
  }

  return clampShare(Math.abs(leftValue) / total);
};

const formatAlertMetricValue = (
  alert: AlertEvent,
  value: number | null | undefined,
  language: AppLanguage,
) => {
  if (!isFiniteMetric(value)) {
    return '--';
  }

  if (alert.messageKey === 'price_change_pct') {
    return formatMarketPercent(value);
  }

  if (alert.messageKey === 'feed_stale') {
    return language === 'zh-CN'
      ? `${Math.round(value).toLocaleString(language)} 秒`
      : `${Math.round(value).toLocaleString(language)}s`;
  }

  return formatMarketCentsLabel(value, { compact: true }, language);
};

const buildAlertThresholdSnapshot = (
  alert: AlertEvent,
  actual: number | null | undefined,
  threshold: number | null | undefined,
  language: AppLanguage,
): AlertThresholdSnapshot | null => {
  if (!isFiniteMetric(actual) || !isFiniteMetric(threshold)) {
    return null;
  }

  const delta = actual - threshold;
  return {
    actualValue: formatAlertMetricValue(alert, actual, language),
    thresholdValue: formatAlertMetricValue(alert, threshold, language),
    deltaValue: formatAlertMetricValue(alert, Math.abs(delta), language),
    share: buildMetricShare(actual, threshold),
    direction: delta === 0 ? 'touch' : delta > 0 ? 'above' : 'below',
  };
};

const getAlertRuleVisualMeta = (alert: AlertEvent) => {
  const key = (alert.messageKey ?? alert.ruleId ?? '').toLowerCase();

  if (key.includes('spread')) {
    return {
      flowTitle: '价差越线判定',
      signalLabel: '当前价差',
      thresholdLabel: '价差阈值',
      overLabel: '超出幅度',
      underLabel: '低于幅度',
      caption: '先看原始盘口的价差，再对照阈值，最后确认这次命中的规则。',
    };
  }

  if (key.includes('price_change')) {
    return {
      flowTitle: '短时波动判定',
      signalLabel: '当前波动',
      thresholdLabel: '波动阈值',
      overLabel: '超出幅度',
      underLabel: '低于幅度',
      caption: '先看原始盘口的短时变化，再对照阈值，确认是否进入异常波动。',
    };
  }

  if (key.includes('price_threshold')) {
    return {
      flowTitle: '价格越线判定',
      signalLabel: '当前价格',
      thresholdLabel: '价格阈值',
      overLabel: '高出幅度',
      underLabel: '低于幅度',
      caption: '先看原始盘口当前价格，再对照规则阈值，确认是哪一次越线触发。',
    };
  }

  if (key.includes('feed')) {
    return {
      flowTitle: '停更超时判定',
      signalLabel: '停更时长',
      thresholdLabel: '超时阈值',
      overLabel: '超时幅度',
      underLabel: '剩余缓冲',
      caption: '先看数据停更了多久，再对照超时阈值，判断是否已经进入告警区。',
    };
  }

  if (key.includes('liquidity')) {
    if (isTemperatureLadderKillAlert(alert)) {
      return {
        flowTitle: '温度阶梯斩杀',
        signalLabel: '被斩价格',
        thresholdLabel: '触发门槛',
        overLabel: '清空前溢价',
        underLabel: '归零幅度',
        caption: '按同城同日温度阶梯核对：被斩档快速归零，并由相邻温度档确认方向。',
      };
    }

    return {
      flowTitle: '盘口抽空判定',
      signalLabel: '当前深度',
      thresholdLabel: '深度阈值',
      overLabel: '高出幅度',
      underLabel: '缺口幅度',
      caption: '先看原始盘口深度，再对照最小深度阈值，确认这次是否属于抽空风险。',
    };
  }

  if (key.includes('lottery')) {
    return {
      flowTitle: '异常抬升判定',
      signalLabel: '抬升幅度',
      thresholdLabel: '抬升阈值',
      overLabel: '超出幅度',
      underLabel: '低于幅度',
      caption: '先看原始盘口抬升幅度，再对照阈值，判断是不是这次异常彩票信号。',
    };
  }

  if (key.includes('volume_pricing')) {
    return {
      flowTitle: '带量定价判定',
      signalLabel: '成交影响',
      thresholdLabel: '定价阈值',
      overLabel: '超出幅度',
      underLabel: '低于幅度',
      caption: '先看原始盘口成交带来的价格影响，再对照阈值，确认是否命中带量定价规则。',
    };
  }

  return {
    flowTitle: '规则命中判定',
    signalLabel: '关键指标',
    thresholdLabel: '规则阈值',
    overLabel: '超出幅度',
    underLabel: '低于幅度',
    caption: '先确认原始盘口，再看关键指标，最后确认是哪条规则触发了这次告警。',
  };
};

const getPrecisionFocusColumn = (alert: AlertEvent | null): PrecisionFocusColumn => {
  if (!alert) {
    return null;
  }

  const key = (alert.messageKey ?? alert.ruleId ?? '').toLowerCase();
  const liquiditySide = alert.messageParams?.side?.toLowerCase();

  if (key.includes('spread')) {
    return 'spread';
  }

  if (key.includes('price_threshold')) {
    return 'yesPrice';
  }

  if (key.includes('price_change')) {
    return 'change5m';
  }

  if (key.includes('volume_pricing')) {
    return 'ask';
  }

  if (key.includes('lottery')) {
    return 'lottery';
  }

  if (key.includes('feed')) {
    return 'updated';
  }

  if (key.includes('liquidity')) {
    if (isTemperatureLadderKillAlert(alert)) {
      return 'yesPrice';
    }

    if (liquiditySide === 'buy') {
      return 'bid';
    }

    if (liquiditySide === 'sell') {
      return 'ask';
    }
  }

  return null;
};

const getPrecisionFocusMetricValue = (
  row: MarketRow,
  column: Exclude<PrecisionFocusColumn, null>,
): number | null => {
  switch (column) {
    case 'yesPrice':
      return isFiniteMetric(row.yesPrice) ? row.yesPrice : null;
    case 'bid':
      return isFiniteMetric(row.bestBid) ? row.bestBid : null;
    case 'ask':
      return isFiniteMetric(row.bestAsk) ? row.bestAsk : null;
    case 'spread':
      return isFiniteMetric(row.spread) ? row.spread : null;
    case 'change5m':
      return isFiniteMetric(row.change5m) ? row.change5m : null;
    case 'lottery':
      return isFiniteMetric(row.lotteryLift) ? row.lotteryLift : null;
    case 'updated': {
      const timestamp = Date.parse(row.updatedAt);
      return Number.isFinite(timestamp) ? timestamp : null;
    }
    default:
      return null;
  }
};

const formatPrecisionDeltaDuration = (minutes: number, language: AppLanguage) => {
  if (minutes < 60) {
    return language === 'zh-CN' ? `${minutes} 分钟` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  if (language === 'zh-CN') {
    return remainMinutes > 0 ? `${hours} 小时 ${remainMinutes} 分钟` : `${hours} 小时`;
  }

  return remainMinutes > 0 ? `${hours}h ${remainMinutes}m` : `${hours}h`;
};

const formatPrecisionFocusDelta = (
  column: Exclude<PrecisionFocusColumn, null>,
  currentValue: number | null,
  referenceValue: number | null,
  language: AppLanguage,
) => {
  if (!isFiniteMetric(currentValue) || !isFiniteMetric(referenceValue)) {
    return null;
  }

  const delta = currentValue - referenceValue;

  switch (column) {
    case 'yesPrice':
    case 'bid':
    case 'ask':
    case 'spread':
    case 'lottery': {
      if (Math.abs(delta) < 0.0005) {
        return language === 'zh-CN' ? '与告警持平' : 'Matches alert';
      }

      return `${language === 'zh-CN' ? '较告警' : 'vs alert'} ${delta > 0 ? '+' : '-'}${formatMarketCentsLabel(
        Math.abs(delta),
        { compact: true },
        language,
      )}`;
    }
    case 'change5m':
      if (Math.abs(delta) < 0.05) {
        return language === 'zh-CN' ? '与告警持平' : 'Matches alert';
      }

      return `${language === 'zh-CN' ? '较告警' : 'vs alert'} ${formatMarketPercent(delta)}`;
    case 'updated': {
      const deltaMinutes = Math.round(Math.abs(delta) / 60000);
      if (deltaMinutes < 1) {
        return language === 'zh-CN' ? '与告警同步' : 'Matches alert';
      }

      if (language === 'zh-CN') {
        return `较告警 ${delta > 0 ? '晚' : '早'} ${formatPrecisionDeltaDuration(deltaMinutes, language)}`;
      }

      return `vs alert ${formatPrecisionDeltaDuration(deltaMinutes, language)} ${delta > 0 ? 'later' : 'earlier'}`;
    }
    default:
      return null;
  }
};

const getMarketBandClassName = (row: MarketRow, selected: boolean) =>
  cn(
    'market-band',
    `market-band--${row.bubbleSeverity}`,
    marketHasLotterySignal(row) && 'market-band--lottery',
    marketHasWideSpread(row) && 'market-band--wide-spread',
    selected && 'is-selected',
  );

const getMarketRowClassName = (row: MarketRow, selected: boolean, alertFocused = false) =>
  cn(
    'market-table-row',
    marketHasLotterySignal(row) && 'market-table-row--lottery',
    selected && 'is-selected',
    alertFocused && 'is-alert-focus',
  );

const getFocusedColumnClassName = (
  focusedColumn: PrecisionFocusColumn,
  column: Exclude<PrecisionFocusColumn, null>,
  extraClassName?: string,
) =>
  cn(extraClassName, focusedColumn === column && 'is-focus-column');

const groupMarketsByCity = (rows: MarketRow[]) => {
  const groups = new Map<
    string,
    {
      key: string;
      cityName: string;
      rows: MarketRow[];
      riskCount: number;
      watchlistedCount: number;
      maxSeverityWeight: number;
      latestUpdatedAt: string;
    }
  >();

  rows.forEach((row) => {
    const key = row.cityKey || row.cityName;
    const current = groups.get(key);
    if (current) {
      current.rows.push(row);
      current.watchlistedCount += row.watchlisted ? 1 : 0;
      current.riskCount +=
        row.bubbleSeverity === 'critical' || row.bubbleSeverity === 'warning' ? 1 : 0;
      current.maxSeverityWeight = Math.max(
        current.maxSeverityWeight,
        SEVERITY_WEIGHT[row.bubbleSeverity],
      );
      if (Date.parse(row.updatedAt) > Date.parse(current.latestUpdatedAt)) {
        current.latestUpdatedAt = row.updatedAt;
      }
      return;
    }

    groups.set(key, {
      key,
      cityName: row.cityName || row.cityKey,
      rows: [row],
      riskCount: row.bubbleSeverity === 'critical' || row.bubbleSeverity === 'warning' ? 1 : 0,
      watchlistedCount: row.watchlisted ? 1 : 0,
      maxSeverityWeight: SEVERITY_WEIGHT[row.bubbleSeverity],
      latestUpdatedAt: row.updatedAt,
    });
  });

  return [...groups.values()].sort((left, right) => {
    if (left.maxSeverityWeight !== right.maxSeverityWeight) {
      return right.maxSeverityWeight - left.maxSeverityWeight;
    }

    if (left.watchlistedCount !== right.watchlistedCount) {
      return right.watchlistedCount - left.watchlistedCount;
    }

    if (left.riskCount !== right.riskCount) {
      return right.riskCount - left.riskCount;
    }

    if (left.rows.length !== right.rows.length) {
      return right.rows.length - left.rows.length;
    }

    return left.cityName.localeCompare(right.cityName, 'zh-CN');
  });
};

const buildVisibleOverviewRows = (
  rows: MarketRow[],
  selectedMarketId: string | null,
  limit: number,
) => {
  const visibleRows = rows.slice(0, limit);
  if (!selectedMarketId || visibleRows.some((row) => row.marketId === selectedMarketId)) {
    return visibleRows;
  }

  const selectedRow = rows.find((row) => row.marketId === selectedMarketId);
  if (!selectedRow) {
    return visibleRows;
  }

  return [selectedRow, ...visibleRows.filter((row) => row.marketId !== selectedMarketId)].slice(
    0,
    limit,
  );
};

const compareMarketsByAttention = (left: MarketRow, right: MarketRow) => {
  const severityDelta = SEVERITY_WEIGHT[right.bubbleSeverity] - SEVERITY_WEIGHT[left.bubbleSeverity];
  if (severityDelta !== 0) {
    return severityDelta;
  }

  const lotteryDelta = Number(marketHasLotterySignal(right)) - Number(marketHasLotterySignal(left));
  if (lotteryDelta !== 0) {
    return lotteryDelta;
  }

  const spreadDelta = Number(marketHasWideSpread(right)) - Number(marketHasWideSpread(left));
  if (spreadDelta !== 0) {
    return spreadDelta;
  }

  const changeDelta = Math.abs((right.change5m ?? 0) as number) - Math.abs((left.change5m ?? 0) as number);
  if (changeDelta !== 0) {
    return changeDelta;
  }

  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
};

const pickLeadMarketRow = (rows: MarketRow[]) =>
  rows.reduce<MarketRow | null>((best, row) => {
    if (!best) {
      return row;
    }

    return compareMarketsByAttention(best, row) > 0 ? row : best;
  }, null);

const buildCityRiskSummary = (row: MarketRow, language: AppLanguage) => {
  if (marketHasLotterySignal(row)) {
    return {
      band: formatTemperatureBandLabel(row.temperatureBand, language),
      headline: '异常彩票抬升',
      detail: `抬升 ${formatLotteryLiftLabel(row.lotteryLift, language)} · ${MARKET_SEVERITY_LABELS[row.bubbleSeverity]}`,
    };
  }

  if (marketHasWideSpread(row)) {
    return {
      band: formatTemperatureBandLabel(row.temperatureBand, language),
      headline: '价差偏高',
      detail: `价差 ${formatMarketCentsLabel(row.spread, { compact: true }, language)} · 5m ${formatMarketPercent(
        row.change5m,
      )}`,
    };
  }

  return {
    band: formatTemperatureBandLabel(row.temperatureBand, language),
    headline: MARKET_SEVERITY_LABELS[row.bubbleSeverity],
    detail: `5m ${formatMarketPercent(row.change5m)} · YES ${formatMarketCentsLabel(
      row.yesPrice,
      { compact: true, treatZeroAsUnknown: !hasMarketQuoteSignal(row) },
      language,
    )}`,
  };
};

const MarketExplorerRow = memo(
  ({
    row,
    formatTime,
    language,
    selected,
    alertFocused = false,
    alertDriven = false,
    alertTriggerLabel = null,
    focusedColumn = null,
    focusReferenceValue = null,
    onSelect,
  }: MarketExplorerRowProps) => {
    const spreadClass = marketHasWideSpread(row) ? 'value-down' : '';
    const changeClass = row.change5m >= 0 ? 'value-up' : 'value-down';
    const hasQuotes = hasMarketQuoteSignal(row);
    const lotteryLift = marketHasLotterySignal(row) ? formatLotteryLiftLabel(row.lotteryLift, language) : '--';
    const lotteryRoute = formatLotteryRouteLabel(row, language);
    const focusBadgeLabel =
      alertDriven && focusedColumn
        ? alertFocused
          ? '告警值'
          : selected
            ? '对照值'
            : null
        : null;
    const focusDeltaLabel =
      alertDriven && focusedColumn && selected && !alertFocused
        ? formatPrecisionFocusDelta(
            focusedColumn,
            getPrecisionFocusMetricValue(row, focusedColumn),
            focusReferenceValue,
            language,
          )
        : null;
    const renderFocusedCell = (
      column: Exclude<PrecisionFocusColumn, null>,
      value: string,
      options: {
        className?: string;
        title?: string;
      } = {},
    ) => {
      const className = getFocusedColumnClassName(focusedColumn, column, options.className);

      if (focusedColumn === column && focusBadgeLabel) {
        return (
          <td className={className} title={options.title}>
            <div className="market-table-cell__focus">
              <strong>{value}</strong>
              <div className="market-table-cell__focus-meta">
                <span
                  className="market-table-cell__focus-badge"
                  data-testid={`market-precision-focus-badge-${row.marketId}`}
                >
                  {focusBadgeLabel}
                </span>
                {focusDeltaLabel ? (
                  <span
                    className="market-table-cell__focus-delta"
                    data-testid={`market-precision-focus-delta-${row.marketId}`}
                  >
                    {focusDeltaLabel}
                  </span>
                ) : null}
              </div>
            </div>
          </td>
        );
      }

      return (
        <td className={className} title={options.title}>
          {value}
        </td>
      );
    };

    return (
      <tr
        className={getMarketRowClassName(row, selected, alertFocused)}
        data-testid={`market-precision-row-${row.marketId}`}
        onClick={() => onSelect(row.marketId)}
      >
        <td>
          <div className="market-table-row__identity">
            <strong>{row.cityName}</strong>
            <small className="market-table-row__market-id">{row.marketId}</small>
            {alertDriven && (selected || alertFocused) ? (
              <div className="market-table-row__badges">
                {alertFocused ? (
                  <span className="market-table-row__badge market-table-row__badge--alert">
                    原始盘口
                  </span>
                ) : null}
                {selected ? (
                  <span className="market-table-row__badge market-table-row__badge--selected">
                    {alertFocused ? '当前盘口' : '对照盘口'}
                  </span>
                ) : null}
              </div>
            ) : null}
            {alertFocused && alertTriggerLabel ? (
              <small
                className="market-table-row__trigger"
                data-testid={`market-precision-row-trigger-${row.marketId}`}
              >
                {alertTriggerLabel}
              </small>
            ) : null}
          </div>
        </td>
        <td>{row.eventDate}</td>
        <td>{formatTemperatureBandLabel(row.temperatureBand, language)}</td>
        {renderFocusedCell(
          'yesPrice',
          formatMarketCentsLabel(row.yesPrice, { treatZeroAsUnknown: !hasQuotes }, language),
        )}
        {renderFocusedCell(
          'bid',
          formatMarketCentsLabel(row.bestBid, { treatZeroAsUnknown: !hasQuotes }, language),
        )}
        {renderFocusedCell(
          'ask',
          formatMarketCentsLabel(row.bestAsk, { treatZeroAsUnknown: !hasQuotes }, language),
        )}
        {renderFocusedCell(
          'spread',
          formatMarketCentsLabel(row.spread, { treatZeroAsUnknown: !hasQuotes }, language),
          { className: spreadClass },
        )}
        {renderFocusedCell('change5m', formatMarketPercent(row.change5m), { className: changeClass })}
        {renderFocusedCell('lottery', lotteryLift, {
          className: marketHasLotterySignal(row) ? 'value-up market-table-cell--lottery' : 'market-table-cell--lottery',
          title: lotteryRoute ?? undefined,
        })}
        {renderFocusedCell('updated', formatTime(row.updatedAt))}
      </tr>
    );
  },
);

const MarketBand = memo(
  ({ row, formatTime, language, selected, onSelect }: MarketBandProps) => {
    const hasQuotes = hasMarketQuoteSignal(row);
    const changeClass = row.change5m >= 0 ? 'value-up' : 'value-down';
    const lotteryRoute = formatLotteryRouteLabel(row, language);
    const lotterySource = marketHasLotterySignal(row)
      ? formatLotterySourceLabel(row.lotteryConfirmationSource, language)
      : null;
    const lotteryBadge = marketHasLotterySignal(row)
      ? `${language === 'zh-CN' ? '异常彩票' : 'Lottery'} ${formatLotteryLiftLabel(row.lotteryLift, language)}`
      : null;

    return (
      <button
        type="button"
        className={getMarketBandClassName(row, selected)}
        onClick={() => onSelect(row.marketId)}
      >
        <span className="market-band__accent" />
        <span className="market-band__head">
          <strong>{formatTemperatureBandLabel(row.temperatureBand, language)}</strong>
          <span>{MARKET_SEVERITY_LABELS[row.bubbleSeverity]}</span>
        </span>
        <span className="market-band__meta">
          {row.airportCode} · {row.eventDate} · {MARKET_STATUS_LABELS[row.status]}
        </span>
        <span className="market-band__price">
          {formatMarketCentsLabel(row.yesPrice, { treatZeroAsUnknown: !hasQuotes }, language)}
        </span>
        <span className="market-band__metrics">
          <span>
            <em>价差</em>
            <strong className={marketHasWideSpread(row) ? 'value-down' : undefined}>
              {formatMarketCentsLabel(row.spread, { treatZeroAsUnknown: !hasQuotes }, language)}
            </strong>
          </span>
          <span>
            <em>5分钟</em>
            <strong className={changeClass}>{formatMarketPercent(row.change5m)}</strong>
          </span>
          <span>
            <em>更新</em>
            <strong>{formatTime(row.updatedAt)}</strong>
          </span>
        </span>
        <span className="market-band__badges">
          {lotteryBadge ? (
            <span className="market-band__badge market-band__badge--lottery">{lotteryBadge}</span>
          ) : null}
          {lotterySource ? (
            <span className="market-band__badge market-band__badge--source">{lotterySource}</span>
          ) : null}
          {lotteryRoute ? (
            <span className="market-band__badge market-band__badge--route">{lotteryRoute}</span>
          ) : null}
          {row.watchlisted ? <span>已关注</span> : null}
          {marketHasWideSpread(row) ? <span>价差偏高</span> : null}
        </span>
      </button>
    );
  },
);

const AlertFactList = ({ title, items, accent = 'muted' }: AlertFactListProps) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className={`market-alert-facts market-alert-facts--${accent}`}>
      <div className="market-alert-facts__head">
        <strong>{title}</strong>
        <span>{items.length} 项</span>
      </div>
      <div className="market-alert-facts__grid">
        {items.map((item) => (
          <div key={`${title}-${item.label}-${item.value}`} className="market-alert-facts__item">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
};

const PrecisionJudgementPanel = ({ panel, onSelectMarket }: PrecisionJudgementPanelProps) => (
  <section
    className="market-precision-judgement"
    data-testid="market-precision-judgement-panel"
    data-focus-column={panel.column}
    data-focus-mode={panel.mode}
    data-selected-market-id={panel.selectedMarketId}
  >
    <div
      className="market-precision-judgement__primary"
      data-testid="market-precision-judgement-primary"
    >
      <span className="market-precision-judgement__eyebrow">首屏判读</span>
      <strong>{panel.headline}</strong>
      <p>{panel.summary}</p>
      <div className="market-precision-judgement__facts">
        {panel.leadFacts.map((fact) => (
          <div key={fact.key} className="market-precision-judgement__fact">
            <span>{fact.label}</span>
            <strong>{fact.value}</strong>
          </div>
        ))}
      </div>
      {panel.rail ? (
        <div
          className={cn(
            'market-precision-judgement__rail',
            'market-inspector__trigger-rail',
            `is-${panel.rail.direction}`,
          )}
        >
          <div className="market-inspector__trigger-rail-values">
            <div>
              <span>{panel.rail.actualLabel}</span>
              <strong>{panel.rail.actualValue}</strong>
            </div>
            <div>
              <span>{panel.rail.thresholdLabel}</span>
              <strong>{panel.rail.thresholdValue}</strong>
            </div>
            <div>
              <span>{panel.rail.deltaLabel}</span>
              <strong>{panel.rail.deltaValue}</strong>
            </div>
          </div>
          <div className="market-inspector__trigger-rail-track" aria-hidden="true">
            <span
              className="market-inspector__trigger-rail-fill"
              style={panel.rail.share === null ? undefined : { width: `${panel.rail.share * 100}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
    <div
      className="market-precision-judgement__context"
      data-testid="market-precision-judgement-context"
    >
      <div className="market-precision-judgement__context-hero">
        <span>当前语境</span>
        <strong>{panel.mode === 'alert' ? '原始盘口' : '对照盘口'}</strong>
        <p>{panel.contextSummary}</p>
      </div>
      <div className="market-precision-judgement__context-grid">
        {panel.contextFacts.map((fact) => (
          <div key={fact.key} className="market-precision-judgement__context-fact">
            <span>{fact.label}</span>
            <strong>{fact.value}</strong>
          </div>
        ))}
      </div>
      {panel.actionMarketId ? (
        <button
          type="button"
          className="market-precision-judgement__action"
          data-testid="market-precision-judgement-action"
          onClick={() => onSelectMarket(panel.actionMarketId ?? '')}
        >
          {panel.actionLabel}
        </button>
      ) : null}
    </div>
  </section>
);

const InspectorSignalCard = ({ title, label, value }: InspectorSignalCardProps) => (
  <div className="market-inspector-signal-card">
    <span>{title}</span>
    <strong>{value}</strong>
    <em>{label}</em>
  </div>
);

const InspectorCompareCard = ({
  title,
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  detail = null,
  leftShare = null,
  emphasis = 'default',
}: InspectorCompareCardProps) => (
  <div className={cn('market-inspector-compare-card', emphasis === 'primary' && 'is-primary')}>
    <div className="market-inspector-compare-card__head">
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
    <div className="market-inspector-compare-card__values">
      <div>
        <span>{leftLabel}</span>
        <strong>{leftValue}</strong>
      </div>
      <div>
        <span>{rightLabel}</span>
        <strong>{rightValue}</strong>
      </div>
    </div>
    <div className="market-inspector-compare-card__meter" aria-hidden="true">
      <span style={leftShare === null ? undefined : { width: `${leftShare * 100}%` }} />
    </div>
  </div>
);

const extractTemperatureSortValue = (value: string) => {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
};

const formatPreciseMarketCentsLabel = (
  value: number | null | undefined,
  language: AppLanguage,
) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '--';
  }

  if (value <= 0) {
    return language === 'zh-CN' ? '0 美分' : '0¢';
  }

  const cents = value * 100;
  const formatted =
    Math.abs(cents) < 1
      ? cents.toFixed(2)
      : Math.abs(cents) < 100
        ? cents.toFixed(1)
        : cents.toFixed(0);
  const trimmed = formatted.replace(/\.0$/, '');
  return language === 'zh-CN' ? `${trimmed} 美分` : `${trimmed}¢`;
};

const buildTemperatureKillStory = (
  alert: AlertEvent | null,
  selectedMarket: MarketRow | null,
  relatedRows: MarketRow[],
  language: AppLanguage,
): TemperatureKillStory | null => {
  if (!alert || !isTemperatureLadderKillAlert(alert)) {
    return null;
  }

  const params = alert.messageParams ?? {};
  const killedMarketId = params.anchorMarketId ?? alert.marketId;
  const confirmationMarketId = params.confirmationMarketId ?? null;
  const killedBand = params.anchorTemperatureBand ?? alert.marketSnapshot?.temperatureBand ?? selectedMarket?.temperatureBand ?? null;
  const confirmationBand = params.confirmationTemperatureBand ?? null;
  const title =
    params.direction === 'lower' || params.reason === 'temperature_ladder_low'
      ? '低温斩杀'
      : '高温斩杀';
  const directionLabel =
    params.direction === 'lower' || params.reason === 'temperature_ladder_low'
      ? '温度锚点下移'
      : '温度锚点上移';
  const previousPrice = formatPreciseMarketCentsLabel(params.previous, language);
  const currentPrice = formatPreciseMarketCentsLabel(params.actual, language);
  const killedBandLabel = killedBand ? formatTemperatureBandLabel(killedBand, language) : null;
  const confirmationBandLabel = confirmationBand
    ? formatTemperatureBandLabel(confirmationBand, language)
    : null;
  const priceRoute = killedBandLabel
    ? `${killedBandLabel} YES ${previousPrice} → ${currentPrice}`
    : `${previousPrice} → ${currentPrice}`;
  const sortedRows = [...relatedRows].sort(
    (left, right) =>
      extractTemperatureSortValue(left.temperatureBand) -
        extractTemperatureSortValue(right.temperatureBand) ||
      left.temperatureBand.localeCompare(right.temperatureBand, language),
  );
  const focusedIndex = sortedRows.findIndex((row) => row.marketId === killedMarketId);
  const sliceStart =
    sortedRows.length <= 8
      ? 0
      : Math.max(0, Math.min((focusedIndex >= 0 ? focusedIndex : 0) - 3, sortedRows.length - 8));
  const ladderRows = sortedRows.slice(sliceStart, sliceStart + 8).map((row) => {
    const hasQuotes = hasMarketQuoteSignal(row);
    return {
      marketId: row.marketId,
      band: formatTemperatureBandLabel(row.temperatureBand, language),
      bid: formatMarketCentsLabel(row.bestBid, { compact: true, treatZeroAsUnknown: !hasQuotes }, language),
      ask: formatMarketCentsLabel(row.bestAsk, { compact: true, treatZeroAsUnknown: !hasQuotes }, language),
      yes: formatMarketCentsLabel(row.yesPrice, { compact: true, treatZeroAsUnknown: !hasQuotes }, language),
      selected: row.marketId === killedMarketId,
      confirmation: row.marketId === confirmationMarketId,
    };
  });
  const windowLabel =
    typeof params.windowSec === 'number' && Number.isFinite(params.windowSec)
      ? `${Math.round(params.windowSec)} 秒窗口`
      : null;

  return {
    active: true,
    title,
    killedBand: killedBandLabel,
    confirmationBand: confirmationBandLabel,
    killedMarketId,
    confirmationMarketId,
    priceRoute,
    previousPrice,
    currentPrice,
    directionLabel,
    windowLabel,
    sourceLabel: '盘口阶梯确认',
    inferenceNote: '基于市场盘口异动推断，不代表实况数据。',
    ladderRows,
  };
};

const TemperatureKillStoryPanel = ({
  story,
  onSelectMarket,
}: {
  story: TemperatureKillStory;
  onSelectMarket: (marketId: string) => void;
}) => (
  <section className="market-temperature-kill" data-testid="market-temperature-kill-panel">
    <div className="market-temperature-kill__head">
      <span>{story.title}</span>
      <strong>{story.priceRoute}</strong>
      <p>{story.directionLabel} · {story.inferenceNote}</p>
    </div>

    <div className="market-temperature-kill__route">
      <div className="market-temperature-kill__step is-killed">
        <span>被斩温度档</span>
        <strong>{story.killedBand ?? story.killedMarketId}</strong>
        <em>{story.previousPrice} → {story.currentPrice}</em>
      </div>
      <div className="market-temperature-kill__step is-confirmation">
        <span>相邻确认档</span>
        <strong>{story.confirmationBand ?? story.confirmationMarketId ?? '--'}</strong>
        <em>{story.sourceLabel}</em>
      </div>
      <div className="market-temperature-kill__step">
        <span>判读窗口</span>
        <strong>{story.windowLabel ?? '实时窗口'}</strong>
        <em>同城同日阶梯</em>
      </div>
    </div>

    {story.ladderRows.length > 0 ? (
      <div className="market-temperature-kill__ladder" data-testid="market-temperature-kill-ladder">
        {story.ladderRows.map((row) => (
          <button
            key={`temperature-kill-${row.marketId}`}
            type="button"
            className={cn(
              'market-temperature-kill__ladder-row',
              row.selected && 'is-killed',
              row.confirmation && 'is-confirmation',
            )}
            onClick={() => onSelectMarket(row.marketId)}
          >
            <span>{row.band}</span>
            <strong>Bid {row.bid}</strong>
            <em>Ask {row.ask}</em>
          </button>
        ))}
      </div>
    ) : null}
  </section>
);

export const MarketExplorerView = ({
  rows,
  total,
  query,
  focusMarketId = null,
  focusAlert = null,
  onQueryChange,
  onRefresh,
}: MarketExplorerViewProps) => {
  const { copy, formatTime, language, sortByLabel } = useI18n();
  const [cityKey, setCityKey] = useState(query.cityKey ?? '');
  const [eventDate, setEventDate] = useState(query.eventDate ?? '');
  const [sideFilter, setSideFilter] = useState<MarketSideFilter>(
    query.side === 'YES' || query.side === 'NO' ? query.side : '',
  );
  const [watchlistOnly, setWatchlistOnly] = useState(Boolean(query.watchlistedOnly));
  const [viewMode, setViewMode] = useState<MarketExplorerMode>('overview');
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const pendingFocusMarketIdRef = useRef<string | null>(null);

  const deferredCityKey = useDeferredValue(cityKey);
  const cityGroups = useMemo(() => groupMarketsByCity(rows), [rows]);
  const visiblePrecisionRows = useMemo(
    () => rows.slice(0, PRECISION_TABLE_ROW_LIMIT),
    [rows],
  );
  const selectedMarket = useMemo(
    () => rows.find((row) => row.marketId === selectedMarketId) ?? rows[0] ?? null,
    [rows, selectedMarketId],
  );
  const hasFocusContext = Boolean(focusAlert || focusMarketId);
  const focusedCityGroupKey = hasFocusContext
    ? selectedMarket?.cityKey || selectedMarket?.cityName || focusAlert?.cityKey || null
    : null;
  const visibleCityGroups = useMemo(() => {
    if (!focusedCityGroupKey) {
      return cityGroups.slice(0, OVERVIEW_CITY_GROUP_LIMIT);
    }

    const focusedGroup = cityGroups.find((group) => group.key === focusedCityGroupKey);
    if (!focusedGroup) {
      return cityGroups.slice(0, OVERVIEW_CITY_GROUP_LIMIT);
    }

    return [
      focusedGroup,
      ...cityGroups.filter((group) => group.key !== focusedGroup.key).slice(
        0,
        OVERVIEW_CITY_GROUP_LIMIT - 1,
      ),
    ];
  }, [cityGroups, focusedCityGroupKey]);
  const selectedMarketHasQuotes = hasMarketQuoteSignal(selectedMarket);
  const selectedLotteryRoute = selectedMarket ? formatLotteryRouteLabel(selectedMarket, language) : null;
  const selectedLotterySource = selectedMarket
    ? formatLotterySourceLabel(selectedMarket.lotteryConfirmationSource, language)
    : null;
  const focusedAlertSummary = useMemo(
    () => (focusAlert ? buildAlertSummaryDraft(focusAlert) : null),
    [focusAlert],
  );
  const focusedAlertPresentation = focusedAlertSummary?.presentation ?? null;
  const focusedAlertNotification = focusedAlertSummary?.notification ?? null;
  const focusedAlertFacts = focusedAlertSummary?.visibleFacts ?? focusedAlertPresentation?.facts.slice(0, 4) ?? [];
  const focusedAlertContext = focusedAlertPresentation?.context ?? [];
  const focusedAlertSignalCards = useMemo(
    () =>
      focusedAlertFacts.slice(0, 3).map((fact) => ({
        title: fact.label,
        label: focusedAlertPresentation?.ruleLabel ?? '告警',
        value: fact.value,
      })),
    [focusedAlertFacts, focusedAlertPresentation],
  );
  const relatedCityMarkets = useMemo(() => {
    if (!selectedMarket) {
      return [] as MarketRow[];
    }

    return rows
      .filter(
        (row) =>
          row.cityKey === selectedMarket.cityKey && row.eventDate === selectedMarket.eventDate,
      )
      .slice(0, 6);
  }, [rows, selectedMarket]);
  const relatedCityMarketCount = useMemo(() => {
    if (!selectedMarket) {
      return 0;
    }

    return rows.filter(
      (row) =>
        row.cityKey === selectedMarket.cityKey && row.eventDate === selectedMarket.eventDate,
    ).length;
  }, [rows, selectedMarket]);
  const temperatureKillStory = useMemo(
    () =>
      buildTemperatureKillStory(
        focusAlert,
        selectedMarket,
        selectedMarket
          ? rows.filter(
              (row) =>
                row.cityKey === selectedMarket.cityKey &&
                row.eventDate === selectedMarket.eventDate,
            )
          : [],
        language,
      ),
    [focusAlert, language, rows, selectedMarket],
  );
  const alertTriggerEvidence = useMemo<AlertTriggerEvidence | null>(() => {
    if (!focusAlert) {
      return null;
    }

    const visualMeta = getAlertRuleVisualMeta(focusAlert);
    const primaryFact = focusedAlertSummary?.primaryFact ?? focusedAlertFacts[0] ?? null;
    const actual = focusAlert.messageParams?.actual;
    const threshold = focusAlert.messageParams?.threshold;
    const thresholdSnapshot = buildAlertThresholdSnapshot(focusAlert, actual, threshold, language);
    const alertMarketLabel = focusedAlertSummary?.marketId ?? focusAlert.marketId;
    const selectedMarketLabel = selectedMarket?.marketId ?? alertMarketLabel;
    const ruleLabel = focusedAlertPresentation?.ruleLabel ?? '告警';
    const primarySignalValue = primaryFact
      ? `${primaryFact.label} ${primaryFact.value}`
      : focusedAlertSummary?.triggerSummary ?? ruleLabel;
    const rowTriggerLabel = (() => {
      if (thresholdSnapshot) {
        const operator = focusAlert.messageParams?.operator?.trim();
        const operatorLabel = operator && ['>', '>=', '<', '<='].includes(operator) ? operator : 'vs';
        return `触发：${thresholdSnapshot.actualValue} ${operatorLabel} ${thresholdSnapshot.thresholdValue}`;
      }

      if (primaryFact) {
        return `触发：${primaryFact.label} ${primaryFact.value}`;
      }

      return focusedAlertSummary?.triggerSummary ?? `触发：${ruleLabel}`;
    })();

    return {
      visualMeta,
      primaryFact,
      actual,
      threshold,
      thresholdSnapshot,
      alertMarketLabel,
      selectedMarketLabel,
      ruleLabel,
      primarySignalValue,
      rowTriggerLabel,
    };
  }, [
    focusAlert,
    focusedAlertFacts,
    focusedAlertPresentation,
    focusedAlertSummary,
    language,
    selectedMarket,
  ]);
  const alertThresholdCompare = useMemo(() => {
    if (!alertTriggerEvidence?.thresholdSnapshot || temperatureKillStory) {
      return null;
    }

    return {
      title: '触发值 vs 阈值',
      leftLabel: '触发值',
      leftValue: alertTriggerEvidence.thresholdSnapshot.actualValue,
      rightLabel: '阈值',
      rightValue: alertTriggerEvidence.thresholdSnapshot.thresholdValue,
      detail: alertTriggerEvidence.ruleLabel,
      leftShare: alertTriggerEvidence.thresholdSnapshot.share,
      emphasis: 'primary',
    } satisfies InspectorCompareCardProps;
  }, [alertTriggerEvidence, temperatureKillStory]);
  const alertTriggerHighlight = useMemo<AlertTriggerHighlight | null>(() => {
    if (!alertTriggerEvidence) {
      return null;
    }

    const {
      visualMeta,
      primaryFact,
      thresholdSnapshot,
      alertMarketLabel,
      selectedMarketLabel,
      ruleLabel,
      primarySignalValue,
    } = alertTriggerEvidence;

    if (thresholdSnapshot) {
      if (temperatureKillStory) {
        return {
          headline: temperatureKillStory.title,
          summary: `${temperatureKillStory.priceRoute ?? selectedMarketLabel}，${temperatureKillStory.confirmationBand ?? '相邻温度档'}确认。${temperatureKillStory.inferenceNote}`,
          metrics: [
            {
              label: '被斩档',
              value: temperatureKillStory.killedBand ?? temperatureKillStory.killedMarketId,
            },
            {
              label: '价格路径',
              value: temperatureKillStory.priceRoute ?? `${temperatureKillStory.previousPrice} → ${temperatureKillStory.currentPrice}`,
            },
            {
              label: '确认档',
              value: temperatureKillStory.confirmationBand ?? '--',
            },
          ],
          flowTitle: '温度阶梯斩杀',
          flowCaption: '按同城同日温度阶梯核对：被斩温度档快速归零，相邻温度档确认方向。',
          flowSteps: [
            {
              label: '被斩温度档',
              value: temperatureKillStory.killedBand ?? temperatureKillStory.killedMarketId,
            },
            {
              label: '价格路径',
              value: temperatureKillStory.priceRoute ?? '--',
            },
            {
              label: '相邻确认',
              value: temperatureKillStory.confirmationBand ?? temperatureKillStory.confirmationMarketId ?? '--',
            },
          ],
          rail: {
            title: '被斩价格路径',
            actualLabel: '归零后',
            actualValue: thresholdSnapshot.actualValue,
            thresholdLabel: '触发门槛',
            thresholdValue: thresholdSnapshot.thresholdValue,
            deltaLabel: '清空前',
            deltaValue: temperatureKillStory.previousPrice ?? thresholdSnapshot.deltaValue,
            share: thresholdSnapshot.share,
            direction: 'below',
          },
        };
      }

      const delta = thresholdSnapshot.direction === 'touch' ? 0 : thresholdSnapshot.direction === 'above' ? 1 : -1;
      const headline =
        delta === 0 ? '刚好触及阈值' : delta > 0 ? `高出阈值 ${thresholdSnapshot.deltaValue}` : `低于阈值 ${thresholdSnapshot.deltaValue}`;
      const deltaLabel =
        delta === 0 ? '阈值关系' : delta > 0 ? visualMeta.overLabel : visualMeta.underLabel;

      return {
        headline,
        summary: `${selectedMarketLabel} 的${primaryFact?.label ?? '关键指标'}当前为 ${thresholdSnapshot.actualValue}，阈值为 ${thresholdSnapshot.thresholdValue}，因此触发 ${ruleLabel}。`,
        metrics: [
          {
            label: '触发值',
            value: thresholdSnapshot.actualValue,
          },
          {
            label: '阈值',
            value: thresholdSnapshot.thresholdValue,
          },
          {
            label: delta === 0 ? '阈值关系' : delta > 0 ? '超出幅度' : '低于幅度',
            value: delta === 0 ? '触及' : thresholdSnapshot.deltaValue,
          },
        ],
        flowTitle: visualMeta.flowTitle,
        flowCaption: visualMeta.caption,
        flowSteps: [
          {
            label: '原始盘口',
            value: alertMarketLabel,
          },
          {
            label: visualMeta.signalLabel,
            value: thresholdSnapshot.actualValue,
          },
          {
            label: '命中规则',
            value: ruleLabel,
          },
        ],
        rail: {
          title: visualMeta.flowTitle,
          actualLabel: visualMeta.signalLabel,
          actualValue: thresholdSnapshot.actualValue,
          thresholdLabel: visualMeta.thresholdLabel,
          thresholdValue: thresholdSnapshot.thresholdValue,
          deltaLabel,
          deltaValue: delta === 0 ? '触及' : thresholdSnapshot.deltaValue,
          share: thresholdSnapshot.share,
          direction: thresholdSnapshot.direction,
        },
      };
    }

    if (primaryFact) {
      return {
        headline: `${primaryFact.value} 触发告警`,
        summary: `${selectedMarketLabel} 的${primaryFact.label}是本次最关键的异常信号，当前按照 ${ruleLabel} 进入重点核对。`,
        metrics: [
          {
            label: primaryFact.label,
            value: primaryFact.value,
          },
          {
            label: '规则',
            value: ruleLabel,
          },
        ],
        flowTitle: visualMeta.flowTitle,
        flowCaption: visualMeta.caption,
        flowSteps: [
          {
            label: '原始盘口',
            value: alertMarketLabel,
          },
          {
            label: '关键指标',
            value: primarySignalValue,
          },
          {
            label: '命中规则',
            value: ruleLabel,
          },
        ],
        rail: null,
      };
    }

    return {
      headline: focusedAlertNotification?.title ?? ruleLabel,
      summary: focusedAlertSummary?.triggerSummary ?? focusedAlertNotification?.body ?? `当前已按 ${ruleLabel} 进入重点核对。`,
      metrics: [
        {
          label: '盘口',
          value: selectedMarketLabel,
        },
        {
          label: '规则',
          value: ruleLabel,
        },
      ],
      flowTitle: visualMeta.flowTitle,
      flowCaption: visualMeta.caption,
      flowSteps: [
        {
          label: '原始盘口',
          value: alertMarketLabel,
        },
        {
          label: '关键指标',
          value: primarySignalValue,
        },
        {
          label: '命中规则',
          value: ruleLabel,
        },
      ],
      rail: null,
    };
  }, [
    alertTriggerEvidence,
    focusedAlertNotification,
    focusedAlertSummary,
    temperatureKillStory,
  ]);
  const yesNoCompare = useMemo(
    () =>
      selectedMarket
        ? ({
            title: 'YES vs NO',
            leftLabel: 'YES',
            leftValue: formatMarketCentsLabel(
              selectedMarket.yesPrice,
              { treatZeroAsUnknown: !selectedMarketHasQuotes },
              language,
            ),
            rightLabel: 'NO',
            rightValue: formatMarketCentsLabel(
              selectedMarket.noPrice,
              { treatZeroAsUnknown: !selectedMarketHasQuotes },
              language,
            ),
            detail: '方向平衡',
            leftShare: buildMetricShare(selectedMarket.yesPrice, selectedMarket.noPrice),
          } satisfies InspectorCompareCardProps)
        : null,
    [language, selectedMarket, selectedMarketHasQuotes],
  );
  const bidAskCompare = useMemo(
    () =>
      selectedMarket
        ? ({
            title: '买一 vs 卖一',
            leftLabel: '买一',
            leftValue: formatMarketCentsLabel(
              selectedMarket.bestBid,
              { treatZeroAsUnknown: !selectedMarketHasQuotes },
              language,
            ),
            rightLabel: '卖一',
            rightValue: formatMarketCentsLabel(
              selectedMarket.bestAsk,
              { treatZeroAsUnknown: !selectedMarketHasQuotes },
              language,
            ),
            detail: `价差 ${formatMarketCentsLabel(
              selectedMarket.spread,
              { treatZeroAsUnknown: !selectedMarketHasQuotes },
              language,
            )}`,
            leftShare: buildMetricShare(selectedMarket.bestBid, selectedMarket.bestAsk),
          } satisfies InspectorCompareCardProps)
        : null,
    [language, selectedMarket, selectedMarketHasQuotes],
  );
  const hiddenRelatedCityMarketCount = Math.max(
    0,
    relatedCityMarketCount - relatedCityMarkets.length,
  );
  const alertFocusedMarket = useMemo(
    () => (focusAlert ? rows.find((row) => row.marketId === focusAlert.marketId) ?? null : null),
    [focusAlert, rows],
  );
  const isAlertMarketSelected = Boolean(
    focusAlert && selectedMarket && selectedMarket.marketId === focusAlert.marketId,
  );
  const focusedAlertEntryTitle = focusAlert
    ? `已定位到 ${focusedAlertSummary?.marketId ?? focusAlert.marketId}`
    : null;
  const focusedAlertEntryHint =
    focusAlert && selectedMarket
      ? `${selectedMarket.cityName} · ${selectedMarket.eventDate} · ${formatTemperatureBandLabel(selectedMarket.temperatureBand, language)} · 先看触发原因，再横向核对对照盘口。`
      : focusedAlertSummary?.locatorSubtitle
        ? `${focusedAlertSummary.locatorSubtitle} · 先看触发原因，再横向核对对照盘口。`
        : focusedAlertPresentation
          ? `${focusedAlertPresentation.cityLabel} · 先看触发原因，再横向核对对照盘口。`
        : null;
  const focusedAlertObjectSummary =
    focusedAlertSummary?.objectSummary ??
    focusedAlertNotification?.title ??
    focusedAlertEntryTitle;
  const focusedAlertTriggerSummary =
    focusedAlertSummary?.triggerSummary ?? focusedAlertNotification?.body ?? null;
  const focusedAlertDetail = focusedAlertSummary?.detailText ?? focusedAlertPresentation?.detail ?? null;
  const focusedAlertMetaDetail = selectedMarket
    ? `${selectedMarket.cityName} · ${selectedMarket.eventDate}`
    : focusedAlertSummary?.locatorSubtitle ?? focusedAlertPresentation?.cityLabel ?? null;
  const preciseFocusTitle = selectedMarket
    ? focusAlert && !isAlertMarketSelected
      ? `正在对照 ${selectedMarket.marketId}`
      : `正在精确核对 ${selectedMarket.marketId}`
    : null;
  const preciseFocusSummary = selectedMarket
    ? focusAlert
      ? alertFocusedMarket
        ? isAlertMarketSelected
          ? '原始盘口。'
          : `对照盘口，原始盘口是 ${focusAlert.marketId}。`
        : `原始盘口 ${focusAlert.marketId} 不在当前结果里。`
      : '已进入精确模式。'
    : null;
  const preciseAlertRowTriggerLabel = alertTriggerEvidence?.rowTriggerLabel ?? null;
  const preciseFocusColumn = useMemo(() => getPrecisionFocusColumn(focusAlert), [focusAlert]);
  const preciseFocusReferenceValue = useMemo(() => {
    if (!alertFocusedMarket || !preciseFocusColumn) {
      return null;
    }

    return getPrecisionFocusMetricValue(alertFocusedMarket, preciseFocusColumn);
  }, [alertFocusedMarket, preciseFocusColumn]);
  const sameCityCompareMeta = useMemo(() => {
    if (!selectedMarket || !alertFocusedMarket || selectedMarket.marketId === alertFocusedMarket.marketId) {
      return null;
    }

    if (
      selectedMarket.cityKey !== alertFocusedMarket.cityKey ||
      selectedMarket.eventDate !== alertFocusedMarket.eventDate
    ) {
      return null;
    }

    const relatedRows = rows.filter(
      (row) =>
        row.cityKey === alertFocusedMarket.cityKey && row.eventDate === alertFocusedMarket.eventDate,
    );
    const position = relatedRows.findIndex((row) => row.marketId === selectedMarket.marketId);
    if (position < 0) {
      return null;
    }

    return {
      position: position + 1,
      total: relatedRows.length,
    };
  }, [alertFocusedMarket, rows, selectedMarket]);
  const preciseJudgementSource = useMemo<PrecisionJudgementSource | null>(() => {
    if (!focusAlert || !preciseFocusColumn) {
      return null;
    }

    const columnLabelMap: Record<Exclude<PrecisionFocusColumn, null>, string> = {
      yesPrice: copy.dashboard.yesPrice,
      bid: copy.dashboard.bid,
      ask: copy.dashboard.ask,
      spread: copy.dashboard.spread,
      change5m: copy.dashboard.change5m,
      lottery: '异常彩票',
      updated: copy.common.updated,
    };

    const focusLabel = columnLabelMap[preciseFocusColumn];
    const focusTitle = `先看 ${focusLabel}`;
    const alertMarketId = alertTriggerEvidence?.alertMarketLabel ?? focusedAlertSummary?.marketId ?? focusAlert.marketId;
    const triggerDetail = preciseAlertRowTriggerLabel ?? focusedAlertSummary?.triggerSummary ?? null;
    const selectedMarketId = selectedMarket?.marketId ?? null;
    const activeContext = isAlertMarketSelected
      ? '原始盘口'
      : selectedMarketId
        ? `对照盘口 ${selectedMarketId}`
        : '结果列表';
    const thresholdSnapshot = alertTriggerEvidence?.thresholdSnapshot ?? null;
    const compareDelta =
      !isAlertMarketSelected && selectedMarket && alertFocusedMarket
        ? formatPrecisionFocusDelta(
            preciseFocusColumn,
            getPrecisionFocusMetricValue(selectedMarket, preciseFocusColumn),
            getPrecisionFocusMetricValue(alertFocusedMarket, preciseFocusColumn),
            language,
          )
        : null;
    const rail =
      thresholdSnapshot
        ? ({
            title: '告警值与阈值',
            actualLabel: '告警值',
            actualValue: thresholdSnapshot.actualValue,
            thresholdLabel: '阈值',
            thresholdValue: thresholdSnapshot.thresholdValue,
            deltaLabel:
              thresholdSnapshot.direction === 'touch'
                ? '阈值关系'
                : thresholdSnapshot.direction === 'above'
                  ? '高出幅度'
                  : '低于幅度',
            deltaValue: thresholdSnapshot.direction === 'touch' ? '刚好触及' : thresholdSnapshot.deltaValue,
            share: thresholdSnapshot.share,
            direction: thresholdSnapshot.direction,
          } satisfies AlertTriggerRail)
        : null;
    const marketFact: PrecisionFocusGuideFact = {
      key: 'market',
      label: '原始盘口',
      value: alertMarketId,
    };
    const actualFact = thresholdSnapshot
      ? ({
          key: 'actual',
          label: '告警值',
          value: thresholdSnapshot.actualValue,
        } satisfies PrecisionFocusGuideFact)
      : null;
    const thresholdFact = thresholdSnapshot
      ? ({
          key: 'threshold',
          label: '阈值',
          value: thresholdSnapshot.thresholdValue,
        } satisfies PrecisionFocusGuideFact)
      : triggerDetail
        ? ({
            key: 'trigger',
            label: '触发说明',
            value: triggerDetail,
          } satisfies PrecisionFocusGuideFact)
        : null;
    const scopeFact = sameCityCompareMeta
      ? ({
          key: 'scope',
          label: '同城位置',
          value: `${sameCityCompareMeta.position} / ${sameCityCompareMeta.total}`,
        } satisfies PrecisionFocusGuideFact)
      : null;
    const compareFact = compareDelta
      ? ({
          key: 'compare',
          label: '当前差值',
          value: compareDelta,
        } satisfies PrecisionFocusGuideFact)
      : null;
    const contextFact: PrecisionFocusGuideFact = isAlertMarketSelected
      ? {
          key: 'context',
          label: '当前盘口',
          value: activeContext,
        }
      : {
          key: 'context',
          label: '当前盘口',
          value: activeContext,
          actionLabel: '切回原始盘口',
          actionMarketId: focusAlert.marketId,
        };
    const guideFacts = [marketFact, actualFact, thresholdFact, scopeFact, compareFact, contextFact].filter(
      (item): item is PrecisionFocusGuideFact => Boolean(item),
    );
    const leadFacts = [marketFact, actualFact, thresholdFact].filter(
      (item): item is PrecisionFocusGuideFact => Boolean(item),
    );
    const contextFacts = [
      {
        key: 'current',
        label: '当前盘口',
        value: selectedMarketId ?? alertMarketId,
      },
      {
        key: 'focus',
        label: '重点列',
        value: focusLabel,
      },
      scopeFact
        ? {
            key: 'scope',
            label: scopeFact.label,
            value: scopeFact.value,
          }
        : null,
      compareFact
        ? {
            key: 'compare',
            label: compareFact.label,
            value: compareFact.value,
          }
        : null,
    ].filter((fact): fact is PrecisionJudgementContextFact => Boolean(fact));

    return {
      column: preciseFocusColumn,
      mode: isAlertMarketSelected ? 'alert' : 'compare',
      selectedMarketId,
      focusLabel,
      focusTitle,
      focusSummary: isAlertMarketSelected ? '对照告警值，确认为什么触发。' : '先对照告警值，再看当前差值。',
      leadFacts,
      guideFacts,
      contextFacts,
      contextSummary: isAlertMarketSelected
        ? '这就是触发告警的原始盘口。'
        : `当前为对照盘口，原始盘口是 ${alertMarketId}。`,
      actionLabel: !isAlertMarketSelected ? '切回原始盘口' : null,
      actionMarketId: !isAlertMarketSelected ? focusAlert.marketId : null,
      rail,
    };
  }, [
    copy.common.updated,
    copy.dashboard.ask,
    copy.dashboard.bid,
    copy.dashboard.change5m,
    copy.dashboard.spread,
    copy.dashboard.yesPrice,
    alertTriggerEvidence,
    focusAlert,
    isAlertMarketSelected,
    focusedAlertSummary,
    language,
    preciseAlertRowTriggerLabel,
    preciseFocusColumn,
    sameCityCompareMeta,
    selectedMarket,
  ]);
  const preciseFocusGuide = useMemo<PrecisionFocusGuide | null>(() => {
    if (!preciseJudgementSource) {
      return null;
    }

    return {
      column: preciseJudgementSource.column,
      mode: preciseJudgementSource.mode,
      title: preciseJudgementSource.focusTitle,
      summary: preciseJudgementSource.focusSummary,
      facts: preciseJudgementSource.guideFacts,
      rail: preciseJudgementSource.rail,
    };
  }, [preciseJudgementSource]);
  const preciseJudgementPanel = useMemo<PrecisionJudgementPanelData | null>(() => {
    if (!preciseJudgementSource || !preciseJudgementSource.selectedMarketId) {
      return null;
    }

    return {
      column: preciseJudgementSource.column,
      mode: preciseJudgementSource.mode,
      selectedMarketId: preciseJudgementSource.selectedMarketId,
      headline: alertTriggerHighlight?.headline ?? preciseJudgementSource.focusTitle,
      summary: alertTriggerHighlight?.summary ?? preciseJudgementSource.focusSummary,
      leadFacts: preciseJudgementSource.leadFacts,
      contextFacts: preciseJudgementSource.contextFacts,
      contextSummary: preciseJudgementSource.contextSummary,
      actionLabel: preciseJudgementSource.actionLabel,
      actionMarketId: preciseJudgementSource.actionMarketId,
      rail: preciseJudgementSource.rail,
    };
  }, [alertTriggerHighlight, preciseJudgementSource]);
  const preciseFocusPills = [
    focusAlert ? focusedAlertPresentation?.ruleLabel ?? '告警' : '精确模式',
    selectedMarket ? selectedMarket.cityName : null,
    !focusAlert && relatedCityMarketCount > 0 ? `同城同日 ${relatedCityMarketCount} 个盘口` : null,
  ].filter((value): value is string => Boolean(value));
  const hasPreciseJudgementPanel = Boolean(preciseJudgementPanel);
  const isPreciseAlertContext = viewMode === 'precise' && hasPreciseJudgementPanel;
  const inspectorIdentityLabel = focusAlert
    ? alertFocusedMarket
      ? isAlertMarketSelected
        ? '原始盘口'
        : '对照盘口'
      : '结果回退'
    : '当前盘口';
  const inspectorIdentitySummary = selectedMarket
    ? focusAlert
      ? alertFocusedMarket
        ? isAlertMarketSelected
          ? '已定位到原始盘口。'
          : `当前为对照盘口，原始盘口是 ${focusAlert.marketId}。`
        : `原始盘口 ${focusAlert.marketId} 不在当前结果里。`
      : '可继续结合右侧指标核对。'
    : null;
  const visibleCityCount = cityGroups.length;
  const riskCount = rows.filter(
    (row) => row.bubbleSeverity === 'critical' || row.bubbleSeverity === 'warning',
  ).length;
  const visibleOverviewMarketCount = visibleCityGroups.reduce(
    (sum, group) => sum + Math.min(group.rows.length, OVERVIEW_MARKETS_PER_CITY_LIMIT),
    0,
  );
  const hiddenOverviewMarketCount = Math.max(0, rows.length - visibleOverviewMarketCount);
  const hiddenPrecisionRowCount = Math.max(0, rows.length - visiblePrecisionRows.length);
  const hasSearchTerm = cityKey.trim().length > 0;
  const activePreset: MarketExplorerPreset = watchlistOnly ? 'watchlist' : 'all';
  const activeSortBy = query.sortBy ?? DEFAULT_SORT_BY;
  const activeSortDir = query.sortDir ?? DEFAULT_SORT_DIR;
  const describeSort = (sortBy: NonNullable<MarketQuery['sortBy']>) =>
    formatSortOptionLabel(sortBy, language, sortByLabel);
  const activeFilterLabels = [
    hasSearchTerm ? `搜索：${cityKey.trim()}` : '搜索：全部城市/机场',
    eventDate ? `日期：${eventDate}` : '日期：全部',
    watchlistOnly ? '模式：仅看关注盘口' : '模式：全部盘口',
    `方向：${MARKET_SIDE_LABELS[sideFilter]}`,
    `排序：${describeSort(activeSortBy)} / ${activeSortDir === 'desc' ? '降序' : '升序'}`,
  ];

  useEffect(() => {
    setCityKey(query.cityKey ?? '');
  }, [query.cityKey]);

  useEffect(() => {
    setEventDate(query.eventDate ?? '');
  }, [query.eventDate]);

  useEffect(() => {
    setSideFilter(query.side === 'YES' || query.side === 'NO' ? query.side : '');
  }, [query.side]);

  useEffect(() => {
    setWatchlistOnly(Boolean(query.watchlistedOnly));
  }, [query.watchlistedOnly]);

  useEffect(() => {
    startTransition(() => {
      onQueryChange({
        cityKey: deferredCityKey.trim().toLowerCase() || undefined,
      });
    });
  }, [deferredCityKey, onQueryChange]);

  useEffect(() => {
    onQueryChange({
      eventDate: eventDate || undefined,
      side: sideFilter || undefined,
      watchlistedOnly: watchlistOnly || undefined,
    });
  }, [eventDate, onQueryChange, sideFilter, watchlistOnly]);

  useEffect(() => {
    const nextFocusMarketId = focusMarketId ?? focusAlert?.marketId ?? null;
    if (!nextFocusMarketId) {
      pendingFocusMarketIdRef.current = null;
      return;
    }

    pendingFocusMarketIdRef.current = nextFocusMarketId;
    setSelectedMarketId(nextFocusMarketId);
    setViewMode('overview');
  }, [focusAlert, focusMarketId]);

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedMarketId(null);
      return;
    }

    const pendingFocusMarketId = pendingFocusMarketIdRef.current;
    if (pendingFocusMarketId && rows.some((row) => row.marketId === pendingFocusMarketId)) {
      if (selectedMarketId !== pendingFocusMarketId) {
        setSelectedMarketId(pendingFocusMarketId);
      }
      pendingFocusMarketIdRef.current = null;
      return;
    }

    if (!selectedMarketId || !rows.some((row) => row.marketId === selectedMarketId)) {
      setSelectedMarketId(rows[0].marketId);
    }
  }, [rows, selectedMarketId]);

  const clearFilters = () => {
    setCityKey('');
    setEventDate('');
    setSideFilter('');
    setWatchlistOnly(false);
    onQueryChange({
      cityKey: undefined,
      eventDate: undefined,
      side: undefined,
      watchlistedOnly: undefined,
      sortBy: DEFAULT_SORT_BY,
      sortDir: DEFAULT_SORT_DIR,
    });
  };

  const focusSelectedCity = () => {
    if (!selectedMarket) {
      return;
    }

    setCityKey(selectedMarket.cityKey);
    setEventDate(selectedMarket.eventDate);
    setSideFilter(selectedMarket.side === 'YES' || selectedMarket.side === 'NO' ? selectedMarket.side : '');
  };

  const applyPreset = (preset: MarketExplorerPreset) => {
    if (preset === 'watchlist') {
      setWatchlistOnly(true);
      setSideFilter('');
      onQueryChange({
        watchlistedOnly: true,
        side: undefined,
        sortBy: 'updatedAt',
        sortDir: 'desc',
      });
      return;
    }

    setWatchlistOnly(false);
    setSideFilter('');
    onQueryChange({
      watchlistedOnly: undefined,
      side: undefined,
      sortBy: DEFAULT_SORT_BY,
      sortDir: DEFAULT_SORT_DIR,
    });
  };

  return (
    <section className="workspace market-explorer-workspace">
      <section className="panel panel--full market-explorer-shell">
        <header className="panel__header panel__header--stacked market-explorer-shell__header">
          <div>
            <h2>市场总览</h2>
            <span>先按城市和温度区间定位重点盘口，再进入单个市场细节。</span>
          </div>
          <div className="market-explorer-shell__actions">
            <button type="button" className="ghost-button" onClick={clearFilters}>
              清空筛选
            </button>
            <button type="button" className="ghost-button" onClick={onRefresh}>
              {copy.explorer.requery}
            </button>
          </div>
        </header>

        <div className="market-explorer-toolbar">
          {focusAlert && focusedAlertPresentation && focusedAlertNotification ? (
            <div className="market-alert-entry" data-testid="market-alert-entry">
              <div className="market-alert-entry__eyebrow">
                <span>原始盘口</span>
                <strong>{focusedAlertPresentation.ruleLabel}</strong>
              </div>
              <div className="market-alert-entry__body">
                <div>
                  <h3>{focusedAlertObjectSummary ?? focusedAlertEntryTitle ?? focusedAlertNotification.title}</h3>
                  <p>{focusedAlertTriggerSummary ?? focusedAlertNotification.body}</p>
                  {focusedAlertEntryHint ? (
                    <small className="market-alert-entry__hint">{focusedAlertEntryHint}</small>
                  ) : null}
                </div>
                <time dateTime={focusAlert.triggeredAt}>{formatTime(focusAlert.triggeredAt)}</time>
              </div>
            </div>
          ) : null}
          <div className="market-explorer-presets" role="group" aria-label="运营预设">
            <button
              type="button"
              className={cn('market-explorer-preset', activePreset === 'all' && 'is-active')}
              onClick={() => applyPreset('all')}
            >
              全部盘口
            </button>
            <button
              type="button"
              className={cn('market-explorer-preset', activePreset === 'watchlist' && 'is-active')}
              onClick={() => applyPreset('watchlist')}
            >
              关注队列
            </button>
          </div>

          <div className="market-explorer-filters">
            <label className="field field--grow">
              <span>{copy.explorer.cityKey}</span>
              <input
                value={cityKey}
                onChange={(event) => setCityKey(event.target.value)}
                placeholder="输入城市、机场代码或中文名"
              />
            </label>

            <label className="field">
              <span>{copy.explorer.eventDate}</span>
              <input
                type="date"
                value={eventDate}
                onChange={(event) => setEventDate(event.target.value)}
              />
            </label>

            <label className="field field--small">
              <span>方向</span>
              <select value={sideFilter} onChange={(event) => setSideFilter(event.target.value as MarketSideFilter)}>
                <option value="">全部方向</option>
                <option value="YES">是</option>
                <option value="NO">否</option>
              </select>
            </label>

            <label className="field field--small">
              <span>{copy.explorer.sortBy}</span>
              <select
                value={activeSortBy}
                onChange={(event) =>
                  onQueryChange({
                    sortBy: event.target.value as MarketQuery['sortBy'],
                  })
                }
              >
                <option value="volume24h">{describeSort('volume24h')}</option>
                <option value="change5m">{sortByLabel('change5m')}</option>
                <option value="spread">{sortByLabel('spread')}</option>
                <option value="updatedAt">{sortByLabel('updatedAt')}</option>
              </select>
            </label>

            <label className="field field--small">
              <span>{copy.explorer.order}</span>
              <select
                value={query.sortDir ?? DEFAULT_SORT_DIR}
                onChange={(event) =>
                  onQueryChange({
                    sortDir: event.target.value as MarketQuery['sortDir'],
                  })
                }
              >
                <option value="desc">{copy.explorer.desc}</option>
                <option value="asc">{copy.explorer.asc}</option>
              </select>
            </label>

            <label className="field field--checkbox">
              <input
                type="checkbox"
                checked={watchlistOnly}
                onChange={(event) => setWatchlistOnly(event.target.checked)}
              />
              <span>{copy.explorer.watchlistOnly}</span>
            </label>
          </div>

          <div className="market-explorer-toolbar__footer">
            <div className="market-explorer-filter-tags">
              {activeFilterLabels.map((label) => (
                <span key={label}>{label}</span>
              ))}
              <span>{copy.explorer.summary(rows.length, total)}</span>
            </div>
            <div className="market-explorer-view-toggle" role="group" aria-label="视图模式">
              <button
                type="button"
                className={viewMode === 'overview' ? 'is-active' : undefined}
                onClick={() => setViewMode('overview')}
              >
                总览模式
              </button>
              <button
                type="button"
                className={viewMode === 'precise' ? 'is-active' : undefined}
                onClick={() => setViewMode('precise')}
              >
                精确模式
              </button>
            </div>
          </div>
        </div>

        <div className="market-explorer-body">
          <main className="market-explorer-main">
            {focusAlert && focusedAlertPresentation && focusedAlertNotification ? (
              <section className="market-alert-spotlight" data-testid="market-alert-spotlight">
                <div className="market-alert-spotlight__hero">
                  <div className="market-alert-spotlight__copy">
                    <span className="market-alert-spotlight__eyebrow">
                      {focusedAlertPresentation.alertLabel} · {focusedAlertEntryTitle}
                    </span>
                    <h3>{focusedAlertObjectSummary ?? focusedAlertNotification.title}</h3>
                    <p>{focusedAlertTriggerSummary ?? focusedAlertNotification.body}</p>
                    {focusedAlertDetail ? (
                      <small>{focusedAlertDetail}</small>
                    ) : null}
                  </div>
                  <div className="market-alert-spotlight__meta">
                    <span className="market-alert-spotlight__badge">已定位原始盘口</span>
                    <strong>{focusedAlertSummary?.marketId ?? focusAlert.marketId}</strong>
                    {focusedAlertMetaDetail ? <em>{focusedAlertMetaDetail}</em> : null}
                    <small>先看触发原因，再切换对照盘口横向核对。</small>
                  </div>
                </div>

                <div className="market-alert-spotlight__body">
                  <AlertFactList title="触发关键信号" items={focusedAlertFacts} accent="highlight" />
                  <AlertFactList title="定位信息" items={focusedAlertContext} />
                </div>

                {temperatureKillStory ? (
                  <TemperatureKillStoryPanel
                    story={temperatureKillStory}
                    onSelectMarket={setSelectedMarketId}
                  />
                ) : null}

                {selectedMarket && relatedCityMarkets.length > 0 ? (
                  <section className="market-alert-related" data-testid="market-alert-related">
                    <div className="market-alert-related__head">
                      <div>
                        <strong>同城横向核对</strong>
                        <span>已定位 {focusAlert.marketId}，可切换同城同日盘口，再进入精确模式查看全量明细。</span>
                      </div>
                      <button
                        type="button"
                        className="ghost-button"
                        data-testid="market-alert-open-precise"
                        onClick={() => setViewMode('precise')}
                      >
                        进入精确核对
                      </button>
                    </div>

                    <div className="market-alert-related__strip">
                      {relatedCityMarkets.map((row) => (
                        <button
                          key={`related-${row.marketId}`}
                          type="button"
                          className={cn(
                            'market-alert-related__item',
                            row.marketId === selectedMarket.marketId && 'is-selected',
                          )}
                          aria-pressed={row.marketId === selectedMarket.marketId}
                          onClick={() => setSelectedMarketId(row.marketId)}
                        >
                          <div className="market-alert-related__item-head">
                            <strong>{formatTemperatureBandLabel(row.temperatureBand, language)}</strong>
                            <span>
                              {row.marketId === selectedMarket.marketId
                                ? `当前盘口 · ${MARKET_SEVERITY_LABELS[row.bubbleSeverity]}`
                                : MARKET_SEVERITY_LABELS[row.bubbleSeverity]}
                            </span>
                          </div>
                          <div className="market-alert-related__item-metrics">
                            <span>
                              YES{' '}
                              {formatMarketCentsLabel(
                                row.yesPrice,
                                { treatZeroAsUnknown: !hasMarketQuoteSignal(row) },
                                language,
                              )}
                            </span>
                            <span>
                              价差{' '}
                              {formatMarketCentsLabel(
                                row.spread,
                                { treatZeroAsUnknown: !hasMarketQuoteSignal(row) },
                                language,
                              )}
                            </span>
                            <span>5m {formatMarketPercent(row.change5m)}</span>
                          </div>
                        </button>
                      ))}
                    </div>

                    {hiddenRelatedCityMarketCount > 0 ? (
                      <p className="market-alert-related__hint">
                        当前先展示 {relatedCityMarkets.length} 个，同城剩余 {hiddenRelatedCityMarketCount} 个可进入精确模式继续核对。
                      </p>
                    ) : null}
                  </section>
                ) : null}
              </section>
            ) : null}

            <div className="market-explorer-summary">
              <div>
                <span>当前结果</span>
                <strong>{rows.length}</strong>
                <em>共 {total} 个盘口</em>
              </div>
              <div>
                <span>覆盖城市</span>
                <strong>{visibleCityCount}</strong>
                <em>按城市分组展示</em>
              </div>
              <div>
                <span>重点风险</span>
                <strong>{riskCount}</strong>
                <em>预警或高风险盘口</em>
              </div>
            </div>

            {viewMode === 'overview' ? (
              <div className="market-city-groups">
                {cityGroups.length > 0 ? (
                  <>
                    {visibleCityGroups.map((group) => {
                      const visibleRows = buildVisibleOverviewRows(
                        group.rows,
                        selectedMarket?.marketId ?? null,
                        OVERVIEW_MARKETS_PER_CITY_LIMIT,
                      );
                      const hiddenGroupRowCount = group.rows.length - visibleRows.length;
                      const isFocusedGroup = focusedCityGroupKey === group.key;
                      const leadRow = pickLeadMarketRow(group.rows);
                      const leadSummary = leadRow ? buildCityRiskSummary(leadRow, language) : null;
                      return (
                        <section
                          className={cn('market-city-group', isFocusedGroup && 'is-focused')}
                          key={group.key}
                        >
                          <header className="market-city-group__header">
                            <div>
                              <strong>{group.cityName}</strong>
                              <span>
                                {group.rows.length} 个盘口 · 最新更新 {formatTime(group.latestUpdatedAt)}
                              </span>
                              {leadSummary ? (
                                <div
                                  className="market-city-group__signal"
                                  data-testid={`market-city-group-signal-${group.key}`}
                                >
                                  <em>最异常</em>
                                  <strong>{leadSummary.band}</strong>
                                  <span>{leadSummary.headline}</span>
                                  <span>{leadSummary.detail}</span>
                                </div>
                              ) : null}
                            </div>
                            <div className="market-city-group__stats">
                              {isFocusedGroup ? <span className="market-city-group__badge--focus">已定位盘口</span> : null}
                              <span>{group.riskCount} 个重点风险</span>
                              <span>{group.watchlistedCount} 个关注</span>
                            </div>
                          </header>
                          <div className="market-band-grid">
                            {visibleRows.map((row) => (
                              <MarketBand
                                key={row.marketId}
                                row={row}
                                formatTime={formatTime}
                                language={language}
                                selected={row.marketId === selectedMarket?.marketId}
                                onSelect={setSelectedMarketId}
                              />
                            ))}
                          </div>
                          {hiddenGroupRowCount > 0 ? (
                            <div className="market-explorer-limit-hint">
                              该城市还有 {hiddenGroupRowCount} 个盘口，输入日期或温度区间可继续收窄。
                            </div>
                          ) : null}
                        </section>
                      );
                    })}
                    {hiddenOverviewMarketCount > 0 ? (
                      <div className="market-explorer-limit-hint" role="note">
                        首屏仅展示 {visibleCityGroups.length} 个城市、{visibleOverviewMarketCount}{' '}
                        个最有决策价值的盘口；输入城市、机场代码或中文名继续筛选。
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="market-explorer-empty">{copy.explorer.noRows}</div>
                )}
              </div>
            ) : (
              rows.length > 0 ? (
                <>
                  {selectedMarket && preciseFocusTitle && preciseFocusSummary ? (
                    <section
                      className={cn(
                        'market-precision-focus',
                        hasPreciseJudgementPanel && 'market-precision-focus--compact',
                      )}
                      data-testid="market-precision-focus"
                    >
                      <div className="market-precision-focus__main">
                        <div className="market-precision-focus__copy">
                          <span className="market-precision-focus__eyebrow">
                            {focusAlert ? '告警精确核对' : '精确核对'}
                          </span>
                          <strong>{preciseFocusTitle}</strong>
                          <p>{preciseFocusSummary}</p>
                        </div>
                      </div>
                      <div className="market-precision-focus__meta">
                        {preciseFocusPills.map((pill) => (
                          <span key={pill} className="market-precision-focus__pill">
                            {pill}
                          </span>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {preciseJudgementPanel ? (
                    <PrecisionJudgementPanel
                      panel={preciseJudgementPanel}
                      onSelectMarket={setSelectedMarketId}
                    />
                  ) : null}
                  {preciseFocusGuide ? (
                    <div
                      className={cn(
                        'market-precision-guide',
                        hasPreciseJudgementPanel && 'market-precision-guide--compact',
                      )}
                      data-testid="market-precision-guide"
                      data-focus-column={preciseFocusGuide.column}
                      data-focus-mode={preciseFocusGuide.mode}
                    >
                      <strong>{preciseFocusGuide.title}</strong>
                      {!hasPreciseJudgementPanel ? <p>{preciseFocusGuide.summary}</p> : null}
                      {!hasPreciseJudgementPanel && preciseFocusGuide.rail ? (
                        <div
                          className={cn(
                            'market-precision-guide__rail',
                            `is-${preciseFocusGuide.rail.direction}`,
                            'market-inspector__trigger-rail',
                          )}
                          data-testid="market-precision-guide-rail"
                          data-rail-direction={preciseFocusGuide.rail.direction}
                        >
                          <div className="market-inspector__trigger-rail-values">
                            <div>
                              <span>{preciseFocusGuide.rail.actualLabel}</span>
                              <strong>{preciseFocusGuide.rail.actualValue}</strong>
                            </div>
                            <div>
                              <span>{preciseFocusGuide.rail.thresholdLabel}</span>
                              <strong>{preciseFocusGuide.rail.thresholdValue}</strong>
                            </div>
                            <div>
                              <span>{preciseFocusGuide.rail.deltaLabel}</span>
                              <strong>{preciseFocusGuide.rail.deltaValue}</strong>
                            </div>
                          </div>
                          <div className="market-inspector__trigger-rail-track" aria-hidden="true">
                            <span
                              className="market-inspector__trigger-rail-fill"
                              style={
                                preciseFocusGuide.rail.share === null
                                  ? undefined
                                  : { width: `${preciseFocusGuide.rail.share * 100}%` }
                              }
                              />
                          </div>
                        </div>
                      ) : null}
                      {hasPreciseJudgementPanel ? (
                        <div className="market-precision-guide__facts">
                          {preciseJudgementSource ? (
                            preciseJudgementSource.actionMarketId ? (
                              <button
                                type="button"
                                className="market-precision-guide__fact market-precision-guide__fact--button"
                                data-testid="market-precision-guide-fact-context"
                                onClick={() =>
                                  setSelectedMarketId(preciseJudgementSource.actionMarketId ?? null)
                                }
                              >
                                <span>
                                  {preciseJudgementSource.mode === 'alert' ? '原始盘口' : '对照盘口'}
                                </span>
                                <strong>{preciseJudgementSource.selectedMarketId}</strong>
                                {preciseJudgementSource.actionLabel ? (
                                  <small data-testid="market-precision-guide-context-action">
                                    {preciseJudgementSource.actionLabel}
                                  </small>
                                ) : null}
                              </button>
                            ) : (
                              <span
                                className="market-precision-guide__fact"
                                data-testid="market-precision-guide-fact-context"
                              >
                                <span>
                                  {preciseJudgementSource.mode === 'alert' ? '原始盘口' : '对照盘口'}
                                </span>
                                <strong>{preciseJudgementSource.selectedMarketId}</strong>
                              </span>
                            )
                          ) : null}
                        </div>
                      ) : (
                        <div className="market-precision-guide__facts">
                          {preciseFocusGuide.facts.map((fact) =>
                            fact.actionMarketId ? (
                              <button
                                key={fact.key}
                                type="button"
                                className="market-precision-guide__fact market-precision-guide__fact--button"
                                data-testid={`market-precision-guide-fact-${fact.key}`}
                                onClick={() => setSelectedMarketId(fact.actionMarketId ?? null)}
                              >
                                <span>{fact.label}</span>
                                <strong>{fact.value}</strong>
                                {fact.actionLabel ? (
                                  <small data-testid="market-precision-guide-context-action">
                                    {fact.actionLabel}
                                  </small>
                                ) : null}
                              </button>
                            ) : (
                              <span
                                key={fact.key}
                                className="market-precision-guide__fact"
                                data-testid={`market-precision-guide-fact-${fact.key}`}
                              >
                                <span>{fact.label}</span>
                                <strong>{fact.value}</strong>
                              </span>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}
                  <div className="table-wrapper market-precision-table">
                    <table className="dense-table dense-table--scrollable">
                      <thead>
                        <tr>
                          <th>{copy.common.city}</th>
                          <th>{copy.common.date}</th>
                          <th>{copy.dashboard.temperatureBand}</th>
                          <th
                            className={getFocusedColumnClassName(preciseFocusColumn, 'yesPrice')}
                            data-testid="market-precision-header-yesPrice"
                          >
                            {copy.dashboard.yesPrice}
                            {preciseFocusColumn === 'yesPrice' ? <span>重点</span> : null}
                          </th>
                          <th
                            className={getFocusedColumnClassName(preciseFocusColumn, 'bid')}
                            data-testid="market-precision-header-bid"
                          >
                            {copy.dashboard.bid}
                            {preciseFocusColumn === 'bid' ? <span>重点</span> : null}
                          </th>
                          <th
                            className={getFocusedColumnClassName(preciseFocusColumn, 'ask')}
                            data-testid="market-precision-header-ask"
                          >
                            {copy.dashboard.ask}
                            {preciseFocusColumn === 'ask' ? <span>重点</span> : null}
                          </th>
                          <th
                            className={getFocusedColumnClassName(preciseFocusColumn, 'spread')}
                            data-testid="market-precision-header-spread"
                          >
                            {copy.dashboard.spread}
                            {preciseFocusColumn === 'spread' ? <span>重点</span> : null}
                          </th>
                          <th
                            className={getFocusedColumnClassName(preciseFocusColumn, 'change5m')}
                            data-testid="market-precision-header-change5m"
                          >
                            {copy.dashboard.change5m}
                            {preciseFocusColumn === 'change5m' ? <span>重点</span> : null}
                          </th>
                          <th
                            className={getFocusedColumnClassName(preciseFocusColumn, 'lottery')}
                            data-testid="market-precision-header-lottery"
                          >
                            异常彩票
                            {preciseFocusColumn === 'lottery' ? <span>重点</span> : null}
                          </th>
                          <th
                            className={getFocusedColumnClassName(preciseFocusColumn, 'updated')}
                            data-testid="market-precision-header-updated"
                          >
                            {copy.common.updated}
                            {preciseFocusColumn === 'updated' ? <span>重点</span> : null}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visiblePrecisionRows.map((row) => (
                          <MarketExplorerRow
                            key={row.marketId}
                            row={row}
                            formatTime={formatTime}
                            language={language}
                            selected={row.marketId === selectedMarket?.marketId}
                            alertFocused={row.marketId === focusAlert?.marketId}
                            alertDriven={Boolean(focusAlert)}
                            alertTriggerLabel={
                              row.marketId === focusAlert?.marketId ? preciseAlertRowTriggerLabel : null
                            }
                            focusedColumn={preciseFocusColumn}
                            focusReferenceValue={preciseFocusReferenceValue}
                            onSelect={setSelectedMarketId}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {hiddenPrecisionRowCount > 0 ? (
                    <div className="market-explorer-limit-hint" role="note">
                      精确列表已限制展示前 {visiblePrecisionRows.length} 行；请用城市、机场、日期或关注筛选定位。
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="market-explorer-empty">{copy.explorer.noRows}</div>
              )
            )}
          </main>

          <aside className="market-inspector">
            {selectedMarket ? (
              <>
                <div className="market-inspector__header">
                  <span>{inspectorIdentityLabel}</span>
                  <strong>{selectedMarket.cityName}</strong>
                  <em>
                    {selectedMarket.eventDate} · {formatTemperatureBandLabel(selectedMarket.temperatureBand, language)}
                  </em>
                  <div className="market-inspector__identity" data-testid="market-inspector-context">
                    <div className="market-inspector__identity-badges">
                      <span className="market-inspector__identity-badge market-inspector__identity-badge--primary">
                        {inspectorIdentityLabel}
                      </span>
                      <span className="market-inspector__identity-badge">{selectedMarket.marketId}</span>
                      {focusAlert && focusedAlertPresentation?.ruleLabel ? (
                        <span className="market-inspector__identity-badge">
                          {focusedAlertPresentation.ruleLabel}
                        </span>
                      ) : null}
                    </div>
                    {inspectorIdentitySummary ? <p>{inspectorIdentitySummary}</p> : null}
                  </div>
                </div>

                {focusAlert && alertTriggerHighlight ? (
                  <section
                    className={cn(
                      'market-inspector__trigger',
                      isPreciseAlertContext && 'market-inspector__trigger--compact',
                    )}
                    data-testid="market-inspector-trigger"
                  >
                    <span className="market-inspector__trigger-eyebrow">
                      {isPreciseAlertContext ? '辅助核对' : '本次触发原因'}
                    </span>
                    <strong>{alertTriggerHighlight.headline}</strong>
                    <p>
                      {isPreciseAlertContext
                        ? preciseJudgementSource?.contextSummary ?? alertTriggerHighlight.summary
                        : alertTriggerHighlight.summary}
                    </p>
                    {isPreciseAlertContext ? (
                      <div
                        className="market-inspector__trigger-strip"
                        data-testid="market-inspector-trigger-strip"
                      >
                        {preciseJudgementSource?.contextFacts.slice(0, 2).map((fact) => (
                          <span key={fact.key}>
                            <em>{fact.label}</em>
                            <strong>{fact.value}</strong>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <>
                        <div className="market-inspector__trigger-metrics">
                          {alertTriggerHighlight.metrics.map((item) => (
                            <div key={`${item.label}-${item.value}`}>
                              <span>{item.label}</span>
                              <strong>{item.value}</strong>
                            </div>
                          ))}
                        </div>
                        <div
                          className="market-inspector__trigger-flow"
                          data-testid="market-inspector-trigger-flow"
                        >
                          <div className="market-inspector__trigger-flow-head">
                            <strong>{alertTriggerHighlight.flowTitle}</strong>
                            <span>{alertTriggerHighlight.flowCaption}</span>
                          </div>
                          {alertTriggerHighlight.rail ? (
                            <div
                              className={cn(
                                'market-inspector__trigger-rail',
                                `is-${alertTriggerHighlight.rail.direction}`,
                              )}
                              data-testid="market-inspector-trigger-rail"
                            >
                              <div className="market-inspector__trigger-rail-values">
                                <div>
                                  <span>{alertTriggerHighlight.rail.actualLabel}</span>
                                  <strong>{alertTriggerHighlight.rail.actualValue}</strong>
                                </div>
                                <div>
                                  <span>{alertTriggerHighlight.rail.thresholdLabel}</span>
                                  <strong>{alertTriggerHighlight.rail.thresholdValue}</strong>
                                </div>
                                <div>
                                  <span>{alertTriggerHighlight.rail.deltaLabel}</span>
                                  <strong>{alertTriggerHighlight.rail.deltaValue}</strong>
                                </div>
                              </div>
                              <div className="market-inspector__trigger-rail-track" aria-hidden="true">
                                <span
                                  className="market-inspector__trigger-rail-fill"
                                  style={
                                    alertTriggerHighlight.rail.share === null
                                      ? undefined
                                      : { width: `${alertTriggerHighlight.rail.share * 100}%` }
                                  }
                                />
                              </div>
                            </div>
                          ) : null}
                          <div className="market-inspector__trigger-steps">
                            {alertTriggerHighlight.flowSteps.map((step) => (
                              <div
                                key={`${step.label}-${step.value}`}
                                className="market-inspector__trigger-step"
                              >
                                <span>{step.label}</span>
                                <strong>{step.value}</strong>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </section>
                ) : null}

                {temperatureKillStory ? (
                  <TemperatureKillStoryPanel
                    story={temperatureKillStory}
                    onSelectMarket={setSelectedMarketId}
                  />
                ) : null}

                {focusAlert && !isPreciseAlertContext && focusedAlertSignalCards.length > 0 ? (
                  <section className="market-inspector__section" data-testid="market-inspector-analysis">
                    <div className="market-inspector__section-head">
                      <strong>告警拆解</strong>
                      <span>把这次触发拆成几条最关键的信号。</span>
                    </div>
                    <div className="market-inspector__signal-grid">
                      {focusedAlertSignalCards.map((card) => (
                        <InspectorSignalCard
                          key={`${card.title}-${card.value}`}
                          title={card.title}
                          label={card.label}
                          value={card.value}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}

                {focusAlert && !isPreciseAlertContext ? (
                  <section className="market-inspector__section" data-testid="market-inspector-compare">
                    <div className="market-inspector__section-head">
                      <strong>关键对比</strong>
                      <span>先看触发条件，再看盘口两侧和方向失衡。</span>
                    </div>
                    <div className="market-inspector__compare-grid">
                      {alertThresholdCompare ? <InspectorCompareCard {...alertThresholdCompare} /> : null}
                      {yesNoCompare ? <InspectorCompareCard {...yesNoCompare} /> : null}
                      {bidAskCompare ? <InspectorCompareCard {...bidAskCompare} /> : null}
                    </div>
                  </section>
                ) : null}

                <div
                  className={cn(
                    'market-inspector__hero',
                    isPreciseAlertContext && 'market-inspector__hero--compact',
                  )}
                >
                  <div>
                    <span>“是”价格</span>
                    <strong>
                      {formatMarketCentsLabel(
                        selectedMarket.yesPrice,
                        { treatZeroAsUnknown: !selectedMarketHasQuotes },
                        language,
                      )}
                    </strong>
                    <p>市场当前主价格，优先用于快速判断方向。</p>
                  </div>
                  <div>
                    <span>“否”价格</span>
                    <strong>
                      {formatMarketCentsLabel(
                        selectedMarket.noPrice,
                        { treatZeroAsUnknown: !selectedMarketHasQuotes },
                        language,
                      )}
                    </strong>
                    <p>和“是”价格配合判断盘口是否平衡。</p>
                  </div>
                </div>

                {marketHasLotterySignal(selectedMarket) ? (
                  <div className="market-inspector__lottery">
                    <div className="market-inspector__lottery-head">
                      <span>异常彩票信号</span>
                      <strong>{formatLotteryLiftLabel(selectedMarket.lotteryLift, language)}</strong>
                      <em>{selectedLotteryRoute ?? '超低价盘口被快速推高'}</em>
                    </div>
                    <div
                      className={cn(
                        'market-inspector__metrics',
                        'market-inspector__metrics--lottery',
                        isPreciseAlertContext && 'market-inspector__metrics--compact',
                      )}
                    >
                      <div>
                        <span>确认路径</span>
                        <strong>{selectedLotterySource}</strong>
                      </div>
                      <div>
                        <span>有效数量</span>
                        <strong>{formatLotterySizeLabel(selectedMarket.lotteryEffectiveSize, language)}</strong>
                      </div>
                      <div>
                        <span>有效金额</span>
                        <strong>
                          {formatLotteryNotionalLabel(selectedMarket.lotteryEffectiveNotional, language)}
                        </strong>
                      </div>
                      <div>
                        <span>信号时间</span>
                        <strong>
                          {selectedMarket.lotteryUpdatedAt ? formatTime(selectedMarket.lotteryUpdatedAt) : '--'}
                        </strong>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div
                  className={cn(
                    'market-inspector__metrics',
                    isPreciseAlertContext && 'market-inspector__metrics--compact',
                  )}
                >
                  <div>
                    <span>买一</span>
                    <strong>
                      {formatMarketCentsLabel(
                        selectedMarket.bestBid,
                        { treatZeroAsUnknown: !selectedMarketHasQuotes },
                        language,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>卖一</span>
                    <strong>
                      {formatMarketCentsLabel(
                        selectedMarket.bestAsk,
                        { treatZeroAsUnknown: !selectedMarketHasQuotes },
                        language,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>价差</span>
                    <strong className={marketHasWideSpread(selectedMarket) ? 'value-down' : undefined}>
                      {formatMarketCentsLabel(
                        selectedMarket.spread,
                        { treatZeroAsUnknown: !selectedMarketHasQuotes },
                        language,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>5分钟变化</span>
                    <strong className={selectedMarket.change5m >= 0 ? 'value-up' : 'value-down'}>
                      {formatMarketPercent(selectedMarket.change5m)}
                    </strong>
                  </div>
                  <div>
                    <span>状态</span>
                    <strong>{MARKET_STATUS_LABELS[selectedMarket.status]}</strong>
                  </div>
                  <div>
                    <span>风险等级</span>
                    <strong>{MARKET_SEVERITY_LABELS[selectedMarket.bubbleSeverity]}</strong>
                  </div>
                  <div>
                    <span>{copy.common.updated}</span>
                    <strong>{formatTime(selectedMarket.updatedAt)}</strong>
                  </div>
                </div>

                <div className="market-inspector__footer">
                  <span>最近更新：{formatTime(selectedMarket.updatedAt)}</span>
                  <span>机场代码：{selectedMarket.airportCode}</span>
                  <span>{selectedMarket.watchlisted ? '已加入关注盘口' : '未加入关注盘口'}</span>
                </div>

                <div className="market-inspector__actions">
                  <button type="button" className="ghost-button" onClick={focusSelectedCity}>
                    只看这个城市
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setViewMode('precise')}
                  >
                    查看精确数值
                  </button>
                </div>
              </>
            ) : (
              <div className="market-inspector__empty">
                <strong>还没有可检视的盘口</strong>
                <span>调整筛选条件后，点击任意市场带即可查看详细价格和状态。</span>
              </div>
            )}
          </aside>
        </div>
      </section>
    </section>
  );
};
