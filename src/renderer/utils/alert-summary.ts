import type { AlertEvent, Severity } from '../types/contracts';
import {
  formatTemperatureBandLabel,
  formatMarketCents,
  formatMarketPercent,
  hasMarketQuoteSignal,
} from './market-display';

export interface AlertPresentation {
  cityLabel: string;
  ruleLabel: string;
  severityLabel: string;
  acknowledgementLabel: string;
  title: string;
  summary: string;
  detail: string | null;
}

export const ALERT_SEVERITY_LABELS: Record<Severity, string> = {
  critical: '紧急',
  warning: '预警',
  info: '提示',
};

const ALERT_RULE_LABELS: Record<string, string> = {
  price_threshold: '价格触发',
  price_change_pct: '短时波动',
  price_change_5m: '短时波动',
  spread_threshold: '价差过宽',
  feed_stale: '数据停更',
  liquidity_kill: '流动性骤降',
  system_error: '系统异常',
};

const OPERATOR_LABELS: Record<string, string> = {
  '>': '高于',
  '>=': '不低于',
  '<': '低于',
  '<=': '不高于',
  crosses: '触及',
};

const SYSTEM_SOURCE_LABELS: Record<string, string> = {
  worker: '后台任务异常',
  discovery: '发现服务异常',
  ws: '实时连接异常',
  db: '本地数据服务异常',
  packaging: '运行资源缺失',
  network: '网络连接异常',
  startup: '启动流程异常',
  unknown: '未知异常',
};

const CHINESE_PATTERN = /[\u3400-\u9fff]/;
const LATIN_PATTERN = /[A-Za-z]/;

const cleanText = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() ?? '';

const hasChineseText = (value?: string | null) => CHINESE_PATTERN.test(cleanText(value));

const formatReadableCents = (
  value: Parameters<typeof formatMarketCents>[0],
  options?: Parameters<typeof formatMarketCents>[1],
) => formatMarketCents(value, options).replace(/¢/g, ' 美分');

const isReadableChineseText = (value?: string | null) => {
  const text = cleanText(value);
  if (!text) {
    return false;
  }

  return hasChineseText(text) && !LATIN_PATTERN.test(text);
};

const pickChineseText = (value?: string | null) => {
  const text = cleanText(value);
  return isReadableChineseText(text) ? text : '';
};

const formatDurationLabel = (value?: number | null) => {
  if (!value || !Number.isFinite(value)) {
    return null;
  }

  if (value >= 3600 && value % 3600 === 0) {
    return `${value / 3600} 小时`;
  }

  if (value >= 60 && value % 60 === 0) {
    return `${value / 60} 分钟`;
  }

  return `${value} 秒`;
};

const getAlertKey = (alert: AlertEvent) => alert.messageKey ?? alert.builtinKey ?? '';

const getCurrentPriceText = (alert: AlertEvent) => {
  const actual = alert.messageParams?.actual;
  if (
    getAlertKey(alert) === 'price_threshold' &&
    typeof actual === 'number' &&
    Number.isFinite(actual)
  ) {
    return formatReadableCents(actual);
  }

  const snapshot = alert.marketSnapshot;
  const value = formatReadableCents(snapshot?.yesPrice, {
    treatZeroAsUnknown: !hasMarketQuoteSignal(snapshot),
  });
  return value === '--' ? null : value;
};

const getCurrentSpreadText = (alert: AlertEvent) => {
  const actual = alert.messageParams?.actual;
  if (
    getAlertKey(alert) === 'spread_threshold' &&
    typeof actual === 'number' &&
    Number.isFinite(actual)
  ) {
    return formatReadableCents(actual);
  }

  const snapshot = alert.marketSnapshot;
  const value = formatReadableCents(snapshot?.spread, {
    treatZeroAsUnknown: !hasMarketQuoteSignal(snapshot),
  });
  return value === '--' ? null : value;
};

const getRecentChangeText = (alert: AlertEvent) => {
  const actual = alert.messageParams?.actual;
  const fallback = alert.marketSnapshot?.change5m;
  const alertKey = getAlertKey(alert);
  const formatted = formatMarketPercent(
    (alertKey === 'price_change_pct' || alertKey === 'price_change_5m') &&
      typeof actual === 'number' &&
      Number.isFinite(actual)
      ? actual
      : fallback,
  );
  return formatted === '--' ? null : formatted;
};

const getThresholdText = (alert: AlertEvent) => {
  const value = formatReadableCents(alert.messageParams?.threshold);
  return value === '--' ? null : value;
};

const getWindowLabel = (alert: AlertEvent) =>
  formatDurationLabel(alert.messageParams?.windowSec) ||
  (alert.builtinKey === 'price_change_5m' ? '5分钟' : null);

const getChangeDescription = (valueText: string | null, rawValue?: number | null) => {
  if (!valueText) {
    return null;
  }

  const directionlessText = valueText.replace(/^[+-]/, '');
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    if (rawValue > 0) {
      return `上涨 ${directionlessText}`;
    }

    if (rawValue < 0) {
      return `下跌 ${directionlessText}`;
    }
  }

  return `波动 ${valueText}`;
};

const isSystemLevelAlert = (alert: AlertEvent) =>
  !cleanText(alert.marketId) &&
  !cleanText(alert.cityKey) &&
  !cleanText(alert.marketSnapshot?.cityName);

const inferSystemReason = (alert: AlertEvent) => {
  const chineseReason =
    pickChineseText(alert.messageParams?.reason) ||
    pickChineseText(alert.messageParams?.source) ||
    pickChineseText(alert.message);

  if (chineseReason) {
    return chineseReason;
  }

  const normalized = cleanText(
    alert.messageParams?.reason ?? alert.messageParams?.source ?? alert.message,
  ).toLowerCase();

  if (!normalized) {
    return '';
  }

  const sourceLabel = SYSTEM_SOURCE_LABELS[normalized];
  if (sourceLabel) {
    return sourceLabel;
  }

  if (
    normalized.includes('packaged resources') ||
    normalized.includes('cannot find module') ||
    normalized.includes('err_module_not_found')
  ) {
    return '运行资源缺失';
  }

  if (
    normalized.includes('mask is not a function') ||
    normalized.includes('websocket') ||
    normalized.includes(' ws ')
  ) {
    return '实时连接异常';
  }

  if (
    normalized.includes('sqlite') ||
    normalized.includes('better-sqlite3') ||
    normalized.includes('database')
  ) {
    return '本地数据服务异常';
  }

  if (normalized.includes('discover') || normalized.includes('gamma')) {
    return '发现服务异常';
  }

  if (
    normalized.includes('econn') ||
    normalized.includes('enotfound') ||
    normalized.includes('etimedout') ||
    normalized.includes('network') ||
    normalized.includes('proxy') ||
    normalized.includes('tls')
  ) {
    return '网络连接异常';
  }

  if (normalized.includes('timeout')) {
    return '请求超时';
  }

  if (normalized.includes('permission') || normalized.includes('denied')) {
    return '权限不足';
  }

  return '';
};

export const getAlertAcknowledgementLabel = (alert: AlertEvent) =>
  alert.acknowledged ? '已确认' : '待确认';

export const getAlertCityLabel = (alert: AlertEvent) => {
  const cityLabel = pickChineseText(alert.marketSnapshot?.cityName) || pickChineseText(alert.cityKey);
  if (cityLabel) {
    return cityLabel;
  }

  if (isSystemLevelAlert(alert)) {
    return '系统';
  }

  return '该城市';
};

export const getAlertRuleLabel = (alert: AlertEvent) => {
  const alertKey = getAlertKey(alert);
  if (alertKey && ALERT_RULE_LABELS[alertKey]) {
    return ALERT_RULE_LABELS[alertKey];
  }

  const ruleLabel = pickChineseText(alert.ruleId);
  if (ruleLabel) {
    return ruleLabel;
  }

  return isSystemLevelAlert(alert) ? '系统异常' : '自定义规则';
};

const buildPriceThresholdSummary = (alert: AlertEvent) => {
  const currentPrice = getCurrentPriceText(alert);
  const threshold = getThresholdText(alert);
  const operator = OPERATOR_LABELS[alert.messageParams?.operator ?? ''] ?? '达到';

  if (currentPrice && threshold) {
    return `价格到 ${currentPrice}，已${operator}你设的 ${threshold}`;
  }

  if (currentPrice) {
    return `价格到 ${currentPrice}，已触发提醒`;
  }

  return '价格已触发你设的提醒条件';
};

const buildSpreadSummary = (alert: AlertEvent) => {
  const currentSpread = getCurrentSpreadText(alert);
  const threshold = getThresholdText(alert);

  if (currentSpread && threshold) {
    return `价差到 ${currentSpread}，已超过你设的 ${threshold}`;
  }

  if (currentSpread) {
    return `价差到 ${currentSpread}，已触发提醒`;
  }

  return '价差已经明显拉大';
};

const buildChangeSummary = (alert: AlertEvent) => {
  const actualValue =
    typeof alert.messageParams?.actual === 'number' && Number.isFinite(alert.messageParams.actual)
      ? alert.messageParams.actual
      : alert.marketSnapshot?.change5m;
  const changeText = getRecentChangeText(alert);
  const changeDescription = getChangeDescription(changeText, actualValue);
  const windowLabel = getWindowLabel(alert);

  if (windowLabel && changeDescription) {
    return `${windowLabel}内${changeDescription}，波动明显放大`;
  }

  if (changeDescription) {
    return `短时间内${changeDescription}，需要关注`;
  }

  return '短时波动明显放大，需要关注';
};

const buildLiquiditySummary = (alert: AlertEvent) => {
  const sideLabel =
    alert.messageParams?.side === 'buy'
      ? '买盘'
      : alert.messageParams?.side === 'sell'
        ? '卖盘'
        : '盘口';
  const previous = formatReadableCents(alert.messageParams?.previous);
  const actual = formatReadableCents(alert.messageParams?.actual);

  if (previous !== '--' && actual !== '--') {
    return `${sideLabel}报价从 ${previous} 降到 ${actual}，可能不好成交`;
  }

  return `${sideLabel}报价突然变弱，可能不好成交`;
};

const buildFeedStaleSummary = (alert: AlertEvent) => {
  const lagLabel = formatDurationLabel(alert.messageParams?.lagSec);
  return lagLabel ? `数据已 ${lagLabel} 没更新，行情可能不是最新` : '数据更新中断，行情可能不是最新';
};

const buildSystemSummary = (alert: AlertEvent) => {
  const reason = inferSystemReason(alert);

  switch (reason) {
    case '实时连接异常':
      return '实时连接中断，行情可能不会继续刷新';
    case '本地数据服务异常':
      return '本地数据服务异常，告警记录可能无法写入';
    case '发现服务异常':
      return '盘口发现异常，可能找不到新市场';
    case '运行资源缺失':
      return '运行资源缺失，监控可能无法启动';
    case '网络连接异常':
      return '网络连接不稳定，数据更新可能变慢';
    case '请求超时':
      return '请求超时，数据更新可能变慢';
    case '权限不足':
      return '权限不足，部分监控功能可能不可用';
    default:
      return reason ? `系统服务异常：${reason}` : '系统服务异常，请查看运行状态';
  }
};

const buildFallbackSummary = (alert: AlertEvent) => {
  if (isSystemLevelAlert(alert)) {
    return buildSystemSummary(alert);
  }

  const message = pickChineseText(alert.message);
  if (message) {
    return message;
  }

  return `${getAlertRuleLabel(alert)}已触发，请尽快查看`;
};

export const buildAlertSummary = (alert: AlertEvent) => {
  switch (getAlertKey(alert)) {
    case 'price_threshold':
      return buildPriceThresholdSummary(alert);
    case 'spread_threshold':
      return buildSpreadSummary(alert);
    case 'price_change_pct':
    case 'price_change_5m':
      return buildChangeSummary(alert);
    case 'liquidity_kill':
      return buildLiquiditySummary(alert);
    case 'feed_stale':
      return buildFeedStaleSummary(alert);
    case 'system_error':
      return buildSystemSummary(alert);
    default:
      return buildFallbackSummary(alert);
  }
};

export const buildAlertDetail = (alert: AlertEvent) => {
  const details: string[] = [];
  const snapshot = alert.marketSnapshot;
  const alertKey = getAlertKey(alert);
  const bandText = cleanText(snapshot?.temperatureBand);
  const currentPrice = getCurrentPriceText(alert);
  const currentSpread = getCurrentSpreadText(alert);
  const recentChange = getRecentChangeText(alert);
  const systemReason = inferSystemReason(alert);

  if (bandText) {
    details.push(`温度区间：${formatTemperatureBandLabel(bandText)}`);
  }

  switch (alertKey) {
    case 'price_threshold':
      if (recentChange) {
        details.push(`最近5分钟变化：${recentChange}`);
      }
      break;
    case 'spread_threshold':
      if (currentPrice) {
        details.push(`当前价格：${currentPrice}`);
      }
      if (recentChange) {
        details.push(`最近5分钟变化：${recentChange}`);
      }
      break;
    case 'price_change_pct':
    case 'price_change_5m':
      if (currentPrice) {
        details.push(`当前价格：${currentPrice}`);
      }
      if (currentSpread) {
        details.push(`当前价差：${currentSpread}`);
      }
      break;
    case 'liquidity_kill':
      if (currentPrice) {
        details.push(`当前价格：${currentPrice}`);
      }
      if (recentChange) {
        details.push(`最近5分钟变化：${recentChange}`);
      }
      break;
    case 'system_error':
      if (systemReason) {
        details.push(`异常原因：${systemReason}`);
      }
      break;
    default:
      if (isSystemLevelAlert(alert) && systemReason) {
        details.push(`异常原因：${systemReason}`);
      }
      if (currentPrice) {
        details.push(`当前价格：${currentPrice}`);
      }
      if (currentSpread) {
        details.push(`当前价差：${currentSpread}`);
      }
      if (recentChange) {
        details.push(`最近5分钟变化：${recentChange}`);
      }
      break;
  }

  return details.length > 0 ? details.join(' · ') : null;
};

export const buildAlertTitle = (alert: AlertEvent) => {
  const cityLabel = getAlertCityLabel(alert);
  const ruleLabel = getAlertRuleLabel(alert);
  return cityLabel === '系统' ? ruleLabel : `${cityLabel} · ${ruleLabel}`;
};

export const buildAlertHeadline = buildAlertTitle;

export const buildAlertPresentation = (alert: AlertEvent): AlertPresentation => ({
  cityLabel: getAlertCityLabel(alert),
  ruleLabel: getAlertRuleLabel(alert),
  severityLabel: ALERT_SEVERITY_LABELS[alert.severity],
  acknowledgementLabel: getAlertAcknowledgementLabel(alert),
  title: buildAlertTitle(alert),
  summary: buildAlertSummary(alert),
  detail: buildAlertDetail(alert),
});
