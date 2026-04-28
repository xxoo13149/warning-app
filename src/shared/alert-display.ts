export type DisplayLocale = 'zh-CN' | 'en-US';

export type BuiltinRuleKey =
  | 'price_change_5m'
  | 'spread_threshold'
  | 'feed_stale'
  | 'liquidity_kill';

export type AlertMessageKey =
  | 'price_threshold'
  | 'spread_threshold'
  | 'price_change_pct'
  | 'liquidity_kill'
  | 'feed_stale'
  | 'system_error';

export type AlertMetricKey =
  | 'price'
  | 'change5m'
  | 'spread'
  | 'liquidity_kill'
  | 'bidask_gap'
  | 'new_market'
  | 'resolved'
  | 'feed_stale';

export type AlertOperatorKey = '>' | '<' | '>=' | '<=' | 'crosses';
export type MarketSideKey = 'YES' | 'NO' | 'BOTH';

export interface AlertMarketSnapshot {
  cityName?: string | null;
  airportCode?: string | null;
  eventDate?: string | null;
  temperatureBand?: string | null;
  yesPrice?: number | null;
  bestBid?: number | null;
  bestAsk?: number | null;
  spread?: number | null;
  change5m?: number | null;
}

export interface AlertMessageParams {
  operator?: string | null;
  threshold?: number | null;
  actual?: number | null;
  previous?: number | null;
  windowSec?: number | null;
  lagSec?: number | null;
  feedKey?: string | null;
  side?: 'buy' | 'sell' | null;
  source?: string | null;
  reason?: string | null;
}

export interface AlertMessageEnvelope {
  message?: string | null;
  messageKey?: AlertMessageKey | null;
  messageParams?: AlertMessageParams | null;
  marketSnapshot?: AlertMarketSnapshot | null;
}

interface LocalizedMeta {
  zh: string;
  en: string;
  zhAlias?: string;
  enAlias?: string;
  descriptionZh?: string;
  descriptionEn?: string;
}

export const metricMeta: Record<AlertMetricKey, LocalizedMeta> = {
  price: {
    zh: '价格阈值',
    en: 'Price Threshold',
    zhAlias: 'price',
    enAlias: 'price',
    descriptionZh: '当盘口价格高于或低于设定值时触发。',
    descriptionEn: 'Triggers when the market price crosses a configured threshold.',
  },
  change5m: {
    zh: '5分钟异动',
    en: '5m Change',
    zhAlias: 'change5m',
    enAlias: 'change5m',
    descriptionZh: '根据最近 5 分钟的价格变化幅度触发。',
    descriptionEn: 'Triggers on the price move over the last 5 minutes.',
  },
  spread: {
    zh: '价差',
    en: 'Spread',
    zhAlias: 'spread',
    enAlias: 'spread',
    descriptionZh: '当买一和卖一之间的价差过宽时触发。',
    descriptionEn: 'Triggers when the bid/ask spread becomes too wide.',
  },
  liquidity_kill: {
    zh: '流动性消失',
    en: 'Liquidity Kill',
    zhAlias: 'liquidity_kill',
    enAlias: 'liquidity_kill',
    descriptionZh: '当买盘或卖盘在短时间内快速归零时触发。',
    descriptionEn: 'Triggers when bid or ask liquidity rapidly collapses to zero.',
  },
  bidask_gap: {
    zh: '买卖盘缺口',
    en: 'Bid/Ask Gap',
    zhAlias: 'bidask_gap',
    enAlias: 'bidask_gap',
    descriptionZh: '保留指标，当前按价差逻辑处理。',
    descriptionEn: 'Reserved metric currently mapped to spread logic.',
  },
  new_market: {
    zh: '新盘口出现',
    en: 'New Market',
    zhAlias: 'new_market',
    enAlias: 'new_market',
  },
  resolved: {
    zh: '市场结算',
    en: 'Resolved',
    zhAlias: 'resolved',
    enAlias: 'resolved',
  },
  feed_stale: {
    zh: '数据流停滞',
    en: 'Feed Stale',
    zhAlias: 'feed_stale',
    enAlias: 'feed_stale',
    descriptionZh: '当实时数据流在一段时间内没有更新时触发。',
    descriptionEn: 'Triggers when the live feed stops updating for too long.',
  },
};

export const operatorMeta: Record<AlertOperatorKey, LocalizedMeta> = {
  '>': { zh: '高于', en: 'Above', zhAlias: '>', enAlias: '>' },
  '<': { zh: '低于', en: 'Below', zhAlias: '<', enAlias: '<' },
  '>=': { zh: '高于或等于', en: 'At or Above', zhAlias: '>=', enAlias: '>=' },
  '<=': { zh: '低于或等于', en: 'At or Below', zhAlias: '<=', enAlias: '<=' },
  crosses: {
    zh: '穿越阈值',
    en: 'Crosses Threshold',
    zhAlias: 'crosses',
    enAlias: 'crosses',
  },
};

export const builtinRuleMeta: Record<BuiltinRuleKey, LocalizedMeta> = {
  price_change_5m: {
    zh: '5分钟异动',
    en: '5m Move',
    zhAlias: 'change5m',
    enAlias: 'change5m',
    descriptionZh: '监控“是”价格在最近 5 分钟内的波动幅度。',
    descriptionEn: 'Monitors the YES price move over the last 5 minutes.',
  },
  spread_threshold: {
    zh: '价差过宽',
    en: 'Wide Spread',
    zhAlias: 'spread',
    enAlias: 'spread',
    descriptionZh: '监控盘口买一与卖一之间的价差风险。',
    descriptionEn: 'Monitors the spread risk between best bid and ask.',
  },
  feed_stale: {
    zh: '数据流停滞',
    en: 'Feed Stale',
    zhAlias: 'feed_stale',
    enAlias: 'feed_stale',
    descriptionZh: '监控发现服务或 WebSocket 是否长期停滞。',
    descriptionEn: 'Monitors whether discovery or websocket data has gone stale.',
  },
  liquidity_kill: {
    zh: '流动性消失',
    en: 'Liquidity Kill',
    zhAlias: 'liquidity_kill',
    enAlias: 'liquidity_kill',
    descriptionZh: '监控买盘或卖盘快速归零的异常情况。',
    descriptionEn: 'Monitors abrupt bid or ask liquidity collapse.',
  },
};

const pickText = (locale: DisplayLocale, meta: LocalizedMeta, includeAlias = false) => {
  const primary = locale === 'zh-CN' ? meta.zh : meta.en;
  const alias = locale === 'zh-CN' ? meta.zhAlias : meta.enAlias;
  return includeAlias && alias ? `${primary} (${alias})` : primary;
};

export const formatMetricLabel = (
  metric: string,
  locale: DisplayLocale,
  includeAlias = false,
) => {
  const meta = metricMeta[metric as AlertMetricKey];
  return meta ? pickText(locale, meta, includeAlias) : metric;
};

export const formatOperatorLabel = (
  operator: string,
  locale: DisplayLocale,
  includeAlias = false,
) => {
  const meta = operatorMeta[operator as AlertOperatorKey];
  return meta ? pickText(locale, meta, includeAlias) : operator;
};

export const formatBuiltinRuleName = (
  builtinKey: string | null | undefined,
  locale: DisplayLocale,
  includeAlias = false,
) => {
  if (!builtinKey) {
    return null;
  }
  const meta = builtinRuleMeta[builtinKey as BuiltinRuleKey];
  return meta ? pickText(locale, meta, includeAlias) : builtinKey;
};

export const formatBuiltinRuleDescription = (
  builtinKey: string | null | undefined,
  locale: DisplayLocale,
) => {
  if (!builtinKey) {
    return null;
  }
  const meta = builtinRuleMeta[builtinKey as BuiltinRuleKey];
  if (!meta) {
    return null;
  }
  return locale === 'zh-CN' ? meta.descriptionZh ?? null : meta.descriptionEn ?? null;
};

export const formatSideLabel = (side: MarketSideKey, locale: DisplayLocale) => {
  switch (side) {
    case 'YES':
      return locale === 'zh-CN' ? '是' : 'YES';
    case 'NO':
      return locale === 'zh-CN' ? '否' : 'NO';
    default:
      return locale === 'zh-CN' ? '双向' : 'Both';
  }
};

export const formatCents = (value: number | null | undefined, locale: DisplayLocale) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return locale === 'zh-CN' ? '暂无' : 'N/A';
  }
  return `${Math.round(value * 100)}¢`;
};

export const formatSignedPercent = (
  value: number | null | undefined,
  locale: DisplayLocale,
) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return locale === 'zh-CN' ? '暂无' : 'N/A';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
};

export const formatRatio = (value: number | null | undefined, locale: DisplayLocale) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return locale === 'zh-CN' ? '暂无' : 'N/A';
  }
  return `${(value * 100).toFixed(1)}%`;
};

const formatMarketLabel = (locale: DisplayLocale, snapshot?: AlertMarketSnapshot | null) => {
  if (snapshot?.cityName) {
    return snapshot.temperatureBand
      ? `${snapshot.cityName} · ${snapshot.temperatureBand}`
      : snapshot.cityName;
  }
  return locale === 'zh-CN' ? '该盘口' : 'this market';
};

const formatLiquiditySide = (
  side: 'buy' | 'sell' | null | undefined,
  locale: DisplayLocale,
) => {
  if (locale === 'zh-CN') {
    if (side === 'buy') return '买盘';
    if (side === 'sell') return '卖盘';
    return '流动性';
  }
  if (side === 'buy') return 'bid liquidity';
  if (side === 'sell') return 'ask liquidity';
  return 'liquidity';
};

const formatMessageBody = (
  locale: DisplayLocale,
  key: AlertMessageKey,
  params: AlertMessageParams,
  snapshot?: AlertMarketSnapshot | null,
) => {
  const marketLabel = formatMarketLabel(locale, snapshot);

  switch (key) {
    case 'price_threshold':
      return locale === 'zh-CN'
        ? `${marketLabel}触发价格条件：当前 ${formatCents(params.actual, locale)}，${formatOperatorLabel(
            params.operator || '>',
            locale,
          )} ${formatCents(params.threshold, locale)}`
        : `${marketLabel} price alert: now ${formatCents(params.actual, locale)}, ${formatOperatorLabel(
            params.operator || '>',
            locale,
          ).toLowerCase()} ${formatCents(params.threshold, locale)}`;
    case 'spread_threshold':
      return locale === 'zh-CN'
        ? `${marketLabel}价差过宽：当前 ${formatRatio(params.actual, locale)}，${formatOperatorLabel(
            params.operator || '>',
            locale,
          )} ${formatRatio(params.threshold, locale)}`
        : `${marketLabel} spread alert: now ${formatRatio(params.actual, locale)}, ${formatOperatorLabel(
            params.operator || '>',
            locale,
          ).toLowerCase()} ${formatRatio(params.threshold, locale)}`;
    case 'price_change_pct':
      return locale === 'zh-CN'
        ? `${marketLabel}在 ${params.windowSec ?? 0} 秒内波动 ${formatSignedPercent(
            params.actual,
            locale,
          )}`
        : `${marketLabel} moved ${formatSignedPercent(params.actual, locale)} over ${params.windowSec ?? 0}s`;
    case 'liquidity_kill':
      return locale === 'zh-CN'
        ? `${marketLabel}${formatLiquiditySide(params.side, locale)}快速归零：从 ${formatCents(
            params.previous,
            locale,
          )} 降到 ${formatCents(params.actual, locale)}`
        : `${marketLabel} ${formatLiquiditySide(params.side, locale)} dropped from ${formatCents(
            params.previous,
            locale,
          )} to ${formatCents(params.actual, locale)}`;
    case 'feed_stale':
      return locale === 'zh-CN'
        ? `数据流 ${params.feedKey ?? ''} 已停滞 ${params.lagSec ?? 0} 秒`
        : `Feed ${params.feedKey ?? ''} has been stale for ${params.lagSec ?? 0}s`;
    case 'system_error':
    default:
      return locale === 'zh-CN'
        ? `系统错误：${params.reason ?? params.source ?? '未知错误'}`
        : `System error: ${params.reason ?? params.source ?? 'unknown error'}`;
  }
};

export const formatAlertMessage = (locale: DisplayLocale, alert: AlertMessageEnvelope) => {
  if (alert.messageKey) {
    return formatMessageBody(
      locale,
      alert.messageKey,
      alert.messageParams ?? {},
      alert.marketSnapshot,
    );
  }
  return alert.message?.trim() || (locale === 'zh-CN' ? '告警已触发' : 'Alert triggered');
};
