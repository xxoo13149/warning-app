import type {
  AlertMarketSnapshot,
  AlertMessageKey,
  AlertMessageParams,
  BuiltinRuleKey,
} from './alert-display';
import { DEFAULT_CITY_CONFIGS } from './city-seeds';

export type AlertPresentationSeverity = 'info' | 'warning' | 'critical';

export interface AlertPresentationSource {
  id?: string;
  ruleId: string;
  builtinKey?: BuiltinRuleKey;
  triggeredAt?: string;
  cityKey?: string;
  marketId?: string;
  tokenId?: string;
  message?: string;
  messageKey?: AlertMessageKey;
  messageParams?: AlertMessageParams;
  marketSnapshot?: AlertMarketSnapshot;
  severity?: AlertPresentationSeverity;
  acknowledged?: boolean;
  soundProfileId?: string;
}

export interface AlertFact {
  label: string;
  value: string;
  tone?: 'normal' | 'strong' | 'muted';
}

export interface AlertPresentation {
  alertLabel: string;
  cityLabel: string;
  ruleLabel: string;
  title: string;
  summary: string;
  detail: string | null;
  facts: AlertFact[];
  context: AlertFact[];
}

export interface AlertNotificationContent {
  title: string;
  body: string;
}

const CITY_LABELS: Record<string, string> = {
  amsterdam: '阿姆斯特丹',
  ankara: '安卡拉',
  atlanta: '亚特兰大',
  austin: '奥斯汀',
  beijing: '北京',
  'buenos-aires': '布宜诺斯艾利斯',
  busan: '釜山',
  'cape-town': '开普敦',
  chengdu: '成都',
  chicago: '芝加哥',
  chongqing: '重庆',
  dallas: '达拉斯',
  denver: '丹佛',
  helsinki: '赫尔辛基',
  'hong-kong': '香港',
  houston: '休斯敦',
  istanbul: '伊斯坦布尔',
  jakarta: '雅加达',
  jeddah: '吉达',
  'kuala-lumpur': '吉隆坡',
  lagos: '拉各斯',
  london: '伦敦',
  'los-angeles': '洛杉矶',
  lucknow: '勒克瑙',
  madrid: '马德里',
  'mexico-city': '墨西哥城',
  miami: '迈阿密',
  milan: '米兰',
  moscow: '莫斯科',
  munich: '慕尼黑',
  nyc: '纽约',
  'new-york': '纽约',
  'panama-city': '巴拿马城',
  paris: '巴黎',
  'san-francisco': '旧金山',
  'sao-paulo': '圣保罗',
  seattle: '西雅图',
  seoul: '首尔',
  shanghai: '上海',
  shenzhen: '深圳',
  singapore: '新加坡',
  taipei: '台北',
  'tel-aviv': '特拉维夫',
  tokyo: '东京',
  toronto: '多伦多',
  warsaw: '华沙',
  wellington: '惠灵顿',
  wuhan: '武汉',
};

const CITY_ENGLISH_LABELS: Record<string, string> = Object.fromEntries(
  DEFAULT_CITY_CONFIGS.map((city) => [city.cityKey.toLowerCase(), city.displayName]),
);

const RULE_LABELS: Record<string, string> = {
  price_threshold: '价格阈值',
  price_change_pct: '短时异动',
  price_change_5m: '5分钟异动',
  'price-change-5m': '5分钟异动',
  spread_threshold: '价差过宽',
  'spread-threshold': '价差过宽',
  feed_stale: '数据流停滞',
  'feed-stale': '数据流停滞',
  liquidity_kill: '盘口斩杀',
  'liquidity-kill': '盘口斩杀',
  volume_pricing: '带量定价',
  'volume-pricing': '带量定价',
  system_error: '系统异常',
  'worker-error': '系统异常',
};

const OPERATOR_LABELS: Record<string, string> = {
  '>': '高于',
  '>=': '不低于',
  '<': '低于',
  '<=': '不高于',
  crosses: '穿越',
  crosses_above: '上穿',
  crosses_below: '下穿',
};

const cleanText = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() ?? '';
const joinText = (...parts: Array<string | null | undefined>) =>
  parts
    .map((part) => cleanText(part))
    .filter(Boolean)
    .join(' · ');

const normalizeKey = (value?: string | null) => cleanText(value).replace(/-/g, '_').toLowerCase();

const normalizeCityKey = (value?: string | null) => cleanText(value).toLowerCase().replace(/\s+/g, '-');

const hasValue = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const pushFact = (items: AlertFact[], label: string, value: string | null, tone?: AlertFact['tone']) => {
  if (!value || value === '--') {
    return;
  }
  items.push({ label, value, tone });
};

const formatCents = (value: number | null | undefined) => {
  if (!hasValue(value)) {
    return '--';
  }

  const cents = value * 100;
  if (cents === 0) {
    return '0 美分';
  }
  if (Math.abs(cents) < 1) {
    return `${cents > 0 ? '<1' : '>-1'} 美分`;
  }
  if (Math.abs(cents) < 10) {
    return `${Number(cents.toFixed(1))} 美分`;
  }
  return `${Math.round(cents)} 美分`;
};

const formatPercent = (value: number | null | undefined) => {
  if (!hasValue(value)) {
    return '--';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
};

const formatDuration = (seconds: number | null | undefined) => {
  if (!hasValue(seconds) || seconds <= 0) {
    return null;
  }
  if (seconds >= 3600 && seconds % 3600 === 0) {
    return `${seconds / 3600} 小时`;
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    return `${seconds / 60} 分钟`;
  }
  return `${Math.round(seconds)} 秒`;
};

const formatTemperatureBand = (value?: string | null) => {
  const text = cleanText(value);
  if (!text) {
    return null;
  }

  return text
    .replace(/\bless than\s+/gi, '低于 ')
    .replace(/\bmore than\s+/gi, '高于 ')
    .replace(/\bat least\s+/gi, '不低于 ')
    .replace(/\bat most\s+/gi, '不高于 ')
    .replace(/\bbetween\s+/gi, '')
    .replace(/\bfrom\s+/gi, '')
    .replace(/\s+(?:to|through|and)\s+/gi, ' 至 ')
    .replace(/\s+or\s+(?:higher|above|more)\b/gi, ' 以上')
    .replace(/\s+or\s+(?:lower|below|less)\b/gi, ' 以下')
    .replace(/\babove\s+/gi, '高于 ')
    .replace(/\bbelow\s+/gi, '低于 ')
    .replace(/\bover\s+/gi, '高于 ')
    .replace(/\bunder\s+/gi, '低于 ')
    .replace(/\s*°F\b/gi, ' 华氏度')
    .replace(/\s*°C\b/gi, ' 摄氏度')
    .replace(/\s+/g, ' ')
    .trim();
};

const getAlertKey = (alert: AlertPresentationSource) => {
  const structured = normalizeKey(alert.messageKey ?? alert.builtinKey);
  if (structured) {
    return structured;
  }

  const ruleKey = normalizeKey(alert.ruleId);
  if (ruleKey.includes('liquidity')) {
    return 'liquidity_kill';
  }
  if (ruleKey.includes('volume_pricing') || ruleKey.includes('volumepricing')) {
    return 'volume_pricing';
  }
  if (ruleKey.includes('spread')) {
    return 'spread_threshold';
  }
  if (ruleKey.includes('price_change') || ruleKey.includes('price_change_5m')) {
    return 'price_change_5m';
  }
  if (ruleKey.includes('feed')) {
    return 'feed_stale';
  }
  if (ruleKey.includes('worker') || ruleKey.includes('system')) {
    return 'system_error';
  }
  return ruleKey;
};

const parseLegacyMessage = (message?: string | null) => {
  const text = cleanText(message);
  const spreadMatch = text.match(/spread alert .*?:\s*([0-9.]+)\s*([<>]=?)\s*([0-9.]+)/i);
  if (spreadMatch) {
    return {
      kind: 'spread_threshold',
      actual: Number(spreadMatch[1]),
      operator: spreadMatch[2],
      threshold: Number(spreadMatch[3]),
    };
  }

  const liquidityMatch = text.match(
    /\((bid|ask) liquidity\)\s*dropped from\s*([0-9.]+)\s*to\s*([0-9.]+)\s*([<>]=?)\s*([0-9.]+)/i,
  );
  if (liquidityMatch) {
    return {
      kind: 'liquidity_kill',
      side: liquidityMatch[1].toLowerCase() === 'bid' ? 'buy' : 'sell',
      previous: Number(liquidityMatch[2]),
      actual: Number(liquidityMatch[3]),
      operator: liquidityMatch[4],
      threshold: Number(liquidityMatch[5]),
    };
  }

  const priceMatch = text.match(/price alert .*?:\s*([0-9.]+)\s*([<>]=?)\s*([0-9.]+)/i);
  if (priceMatch) {
    return {
      kind: 'price_threshold',
      actual: Number(priceMatch[1]),
      operator: priceMatch[2],
      threshold: Number(priceMatch[3]),
    };
  }

  return null;
};

const getRuleLabel = (alert: AlertPresentationSource) => {
  const key = getAlertKey(alert);
  return RULE_LABELS[key] ?? RULE_LABELS[alert.ruleId] ?? '自定义规则';
};

export const getAlertRuleLabel = getRuleLabel;

const getLegacyAlertCityLabel = (alert: AlertPresentationSource) => {
  const cityKey = cleanText(alert.cityKey).toLowerCase();
  if (cityKey && CITY_LABELS[cityKey]) {
    return CITY_LABELS[cityKey];
  }

  const snapshotCity = cleanText(alert.marketSnapshot?.cityName);
  if (snapshotCity) {
    const normalized = snapshotCity.toLowerCase().replace(/\s+/g, '-');
    return CITY_LABELS[normalized] ?? snapshotCity;
  }

  if (!cleanText(alert.marketId)) {
    return '系统';
  }

  return '未知城市';
};

const getAlertCityDescriptor = (alert: AlertPresentationSource) => {
  const cityKey = normalizeCityKey(alert.cityKey);
  const snapshotCity = cleanText(alert.marketSnapshot?.cityName);
  const snapshotAirportCode = cleanText(alert.marketSnapshot?.airportCode).toUpperCase();
  const normalizedSnapshotCity = normalizeCityKey(snapshotCity);

  const chineseLabel =
    (cityKey && CITY_LABELS[cityKey]) ||
    (normalizedSnapshotCity && CITY_LABELS[normalizedSnapshotCity]) ||
    '';
  const englishLabel =
    snapshotCity ||
    (cityKey && CITY_ENGLISH_LABELS[cityKey]) ||
    (normalizedSnapshotCity && CITY_ENGLISH_LABELS[normalizedSnapshotCity]) ||
    '';

  if (!chineseLabel && !englishLabel && !cleanText(alert.marketId)) {
    return {
      label: '系统',
      isSystem: true,
    };
  }

  const baseLabel = chineseLabel || englishLabel || getLegacyAlertCityLabel(alert);
  const parts = [baseLabel];

  if (snapshotAirportCode) {
    parts.push(snapshotAirportCode);
  }

  if (chineseLabel && englishLabel) {
    parts.push(englishLabel);
  }

  return {
    label: Array.from(new Set(parts.filter(Boolean))).join(' · '),
    isSystem: false,
  };
};

export const getAlertCityLabel = (alert: AlertPresentationSource) => getAlertCityDescriptor(alert).label;

const withAlertCityPrefix = (alert: AlertPresentationSource, text: string) => {
  const descriptor = getAlertCityDescriptor(alert);
  if (descriptor.isSystem) {
    return text;
  }
  return `${descriptor.label}：${text}`;
};

const getPrimaryActual = (alert: AlertPresentationSource) => {
  const legacy = parseLegacyMessage(alert.message);
  return hasValue(alert.messageParams?.actual) ? alert.messageParams.actual : legacy?.actual;
};

const getPrevious = (alert: AlertPresentationSource) => {
  const legacy = parseLegacyMessage(alert.message);
  return hasValue(alert.messageParams?.previous) ? alert.messageParams.previous : legacy?.previous;
};

const getThreshold = (alert: AlertPresentationSource) => {
  const legacy = parseLegacyMessage(alert.message);
  return hasValue(alert.messageParams?.threshold) ? alert.messageParams.threshold : legacy?.threshold;
};

const getOperator = (alert: AlertPresentationSource) => {
  const legacy = parseLegacyMessage(alert.message);
  return cleanText(alert.messageParams?.operator) || legacy?.operator || '';
};

const getLiquiditySide = (alert: AlertPresentationSource) => {
  const legacy = parseLegacyMessage(alert.message);
  const side = alert.messageParams?.side ?? legacy?.side;
  if (side === 'buy') {
    return '买盘';
  }
  if (side === 'sell') {
    return '卖盘';
  }
  return '盘口';
};

const getLiquidityOutcome = (alert: AlertPresentationSource) => {
  const outcome = alert.messageParams?.outcome;
  if (outcome === 'yes') {
    return 'YES';
  }
  if (outcome === 'no') {
    return 'NO';
  }
  return '';
};

const getLiquidityCauseText = (alert: AlertPresentationSource) => {
  const notes: string[] = [];
  switch (alert.messageParams?.source) {
    case 'trade_sweep':
      notes.push('疑似成交扫空');
      break;
    case 'cancel_pull':
      notes.push('疑似撤单抽走');
      break;
    case 'fallback':
      notes.push('来源待确认');
      break;
    default:
      break;
  }

  switch (alert.messageParams?.reason) {
    case 'full_empty':
      notes.push('该侧盘口已空');
      break;
    case 'top_level':
      notes.push('顶档已被清空');
      break;
    default:
      break;
  }

  return notes.join('，');
};

const getVolumePricingCauseText = (alert: AlertPresentationSource) => {
  switch (alert.messageParams?.source) {
    case 'trade_confirmed':
      return '成交量确认';
    case 'edge_volume':
      return '低价卖单被移除';
    case 'book_depth':
      return '新卖一挂单量确认';
    default:
      return '量能确认';
  }
};

const getEffectiveVolumeText = (alert: AlertPresentationSource) => {
  const size = alert.messageParams?.effectiveSize;
  const notional = alert.messageParams?.effectiveNotional;
  if (!hasValue(size) && !hasValue(notional)) {
    return null;
  }

  const parts: string[] = [];
  if (hasValue(size)) {
    parts.push(`${size >= 100 ? Math.round(size) : Number(size.toFixed(2))} 张`);
  }
  if (hasValue(notional)) {
    parts.push(`$${notional >= 100 ? Math.round(notional) : notional.toFixed(2)}`);
  }
  return parts.join(' / ');
};

const buildLocationLine = (alert: AlertPresentationSource) => {
  const cityLabel = getAlertCityLabel(alert);
  if (cityLabel === '系统') {
    return '系统告警';
  }

  return joinText(cityLabel, compactTemperatureBand(alert.marketSnapshot?.temperatureBand));
};

const buildReasonText = (alert: AlertPresentationSource) => {
  const key = getAlertKey(alert);
  const actual = getPrimaryActual(alert);
  const previous = getPrevious(alert);
  const threshold = getThreshold(alert);
  const windowLabel = formatDuration(alert.messageParams?.windowSec);

  switch (key) {
    case 'spread_threshold':
      if (hasValue(actual) && hasValue(threshold)) {
        return `价差扩大到 ${formatCents(actual)}，阈值 ${formatCents(threshold)}`;
      }
      return '盘口价差明显扩大';
    case 'liquidity_kill':
      {
        const outcome = getLiquidityOutcome(alert);
        const sideLabel = getLiquiditySide(alert);
        const target = outcome ? `${outcome} ${sideLabel}` : sideLabel;
        const cause = getLiquidityCauseText(alert);
        if (hasValue(previous) && hasValue(actual)) {
          return cause
            ? `${target}从 ${formatCents(previous)}降到 ${formatCents(actual)}（${cause}）`
            : `${target}从 ${formatCents(previous)}降到 ${formatCents(actual)}`;
        }
        return cause ? `${target}出现盘口斩杀（${cause}）` : `${target}出现盘口斩杀`;
      }
    case 'volume_pricing':
      {
        const outcome = getLiquidityOutcome(alert);
        const prefix = outcome ? `${outcome} ` : '';
        const cause = getVolumePricingCauseText(alert);
        const volume = getEffectiveVolumeText(alert);
        if (hasValue(previous) && hasValue(actual)) {
          return volume
            ? `${prefix}卖一从 ${formatCents(previous)} 推高到 ${formatCents(actual)}，${cause} ${volume}`
            : `${prefix}卖一从 ${formatCents(previous)} 推高到 ${formatCents(actual)}，${cause}`;
        }
        return `${prefix}卖一被带量推高，${cause}`;
      }
    case 'price_change_pct':
    case 'price_change_5m':
      if (hasValue(actual)) {
        return `${windowLabel ?? '短时间'}内波动 ${formatPercent(actual)}`;
      }
      return '短时价格波动明显';
    case 'price_threshold':
      if (hasValue(actual) && hasValue(threshold)) {
        return `价格到 ${formatCents(actual)}，阈值 ${formatCents(threshold)}`;
      }
      return '价格触发设定条件';
    case 'feed_stale': {
      const lag = formatDuration(alert.messageParams?.lagSec);
      return lag ? `${lag}未更新` : '数据流暂停更新';
    }
    case 'system_error':
      return '监控链路出现异常';
    default:
      return '触发了监控规则';
  }
};

const buildLegacySummary = (alert: AlertPresentationSource) =>
  withAlertCityPrefix(alert, buildReasonText(alert));

const buildSummary = (alert: AlertPresentationSource) =>
  withAlertCityPrefix(alert, buildReasonText(alert));

const buildDetail = (alert: AlertPresentationSource) => {
  const parts: string[] = [];
  const band = formatTemperatureBand(alert.marketSnapshot?.temperatureBand);
  const operatorLabel = OPERATOR_LABELS[getOperator(alert)] ?? null;
  const threshold = getThreshold(alert);
  const marketId = cleanText(alert.marketId);

  if (band) {
    parts.push(`温度区间：${band}`);
  }
  if (operatorLabel && hasValue(threshold)) {
    parts.push(`触发条件：${operatorLabel} ${formatCents(threshold)}`);
  }
  if (marketId) {
    parts.push(`盘口编号：${marketId}`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
};

const buildFacts = (alert: AlertPresentationSource) => {
  const facts: AlertFact[] = [];
  const key = getAlertKey(alert);
  const snapshot = alert.marketSnapshot;
  const actual = getPrimaryActual(alert);
  const previous = getPrevious(alert);
  const threshold = getThreshold(alert);

  if (key === 'price_change_pct' || key === 'price_change_5m') {
    pushFact(facts, '触发波动', formatPercent(actual), 'strong');
  } else if (key === 'spread_threshold') {
    pushFact(facts, '触发价差', formatCents(actual), 'strong');
  } else if (key === 'liquidity_kill') {
    pushFact(facts, '监控盘口', `${getLiquidityOutcome(alert) ? `${getLiquidityOutcome(alert)} ` : ''}${getLiquiditySide(alert)}`);
    pushFact(facts, '当前边缘价', formatCents(actual), 'strong');
    pushFact(facts, '被清空前', formatCents(previous));
    pushFact(facts, '事件归因', getLiquidityCauseText(alert));
  } else if (key === 'volume_pricing') {
    pushFact(facts, '监控合约', `${getLiquidityOutcome(alert) || 'YES/NO'} 卖一`);
    pushFact(facts, '带量价', formatCents(actual), 'strong');
    pushFact(facts, '参考价', formatCents(previous));
    pushFact(facts, '有效量', getEffectiveVolumeText(alert));
    pushFact(facts, '确认方式', getVolumePricingCauseText(alert));
  } else {
    pushFact(facts, '触发值', formatCents(actual), 'strong');
  }

  pushFact(facts, '阈值', formatCents(threshold));
  pushFact(facts, '“是”价格', formatCents(snapshot?.yesPrice));
  pushFact(facts, '买一', formatCents(snapshot?.bestBid));
  pushFact(facts, '卖一', formatCents(snapshot?.bestAsk));
  pushFact(facts, '当前价差', formatCents(snapshot?.spread));
  pushFact(facts, '5分钟变化', formatPercent(snapshot?.change5m));

  return facts.slice(0, 6);
};

const buildContext = (alert: AlertPresentationSource) => {
  const context: AlertFact[] = [];
  pushFact(context, '城市', getAlertCityLabel(alert));
  pushFact(context, '规则', getRuleLabel(alert));
  pushFact(context, '温度区间', formatTemperatureBand(alert.marketSnapshot?.temperatureBand));
  pushFact(context, '盘口编号', cleanText(alert.marketId));
  return context;
};

const compactTemperatureBand = (value?: string | null) => {
  const formatted = formatTemperatureBand(value);
  if (!formatted) {
    return null;
  }

  const compactMatch = formatted.match(
    /^(-?\d+(?:\.\d+)?)\s+(华氏度|摄氏度)\s+至\s+(-?\d+(?:\.\d+)?)\s+\2$/,
  );
  if (compactMatch) {
    return `${compactMatch[1]} 至 ${compactMatch[3]} ${compactMatch[2]}`;
  }

  return formatted;
};

const buildReadableSummary = (alert: AlertPresentationSource) =>
  `${getRuleLabel(alert)}：${buildReasonText(alert)}`;

const buildReadableDetail = (alert: AlertPresentationSource) => {
  const parts: string[] = [];
  const snapshot = alert.marketSnapshot;
  const append = (label: string, value: string | null) => {
    if (!value || value === '--') {
      return;
    }
    parts.push(`${label} ${value}`);
  };

  append('当前价格', formatCents(snapshot?.yesPrice));
  append('买一', formatCents(snapshot?.bestBid));
  append('卖一', formatCents(snapshot?.bestAsk));
  append('价差', formatCents(snapshot?.spread));
  append('5分钟变化', formatPercent(snapshot?.change5m));

  return parts.length > 0 ? parts.join(' · ') : null;
};

const buildNotificationValueParts = (alert: AlertPresentationSource) => {
  const key = getAlertKey(alert);
  const actual = getPrimaryActual(alert);
  const previous = getPrevious(alert);
  const threshold = getThreshold(alert);
  const lag = formatDuration(alert.messageParams?.lagSec);

  switch (key) {
    case 'liquidity_kill': {
      const outcome = getLiquidityOutcome(alert);
      const prefix = outcome ? `${outcome} ${getLiquiditySide(alert)}` : getLiquiditySide(alert);
      const cause = getLiquidityCauseText(alert);
      if (hasValue(previous) && hasValue(actual)) {
        return cause
          ? [`${prefix} ${formatCents(previous)} → ${formatCents(actual)}`, cause]
          : [`${prefix} ${formatCents(previous)} → ${formatCents(actual)}`];
      }
      if (hasValue(actual)) {
        return cause
          ? [`${prefix} ${formatCents(actual)}`, cause]
          : [`${prefix} ${formatCents(actual)}`];
      }
      return cause ? [cause] : [];
    }
    case 'volume_pricing': {
      const outcome = getLiquidityOutcome(alert);
      const prefix = outcome ? `${outcome} 卖一` : '卖一';
      const parts: string[] = [];
      if (hasValue(previous) && hasValue(actual)) {
        parts.push(`${prefix} ${formatCents(previous)} -> ${formatCents(actual)}`);
      } else if (hasValue(actual)) {
        parts.push(`${prefix} ${formatCents(actual)}`);
      }
      const volume = getEffectiveVolumeText(alert);
      if (volume) {
        parts.push(`有效量 ${volume}`);
      }
      parts.push(getVolumePricingCauseText(alert));
      return parts;
    }
    case 'spread_threshold': {
      const parts: string[] = [];
      if (hasValue(actual)) {
        parts.push(`价差 ${formatCents(actual)}`);
      }
      if (hasValue(threshold)) {
        parts.push(`阈值 ${formatCents(threshold)}`);
      }
      return parts;
    }
    case 'price_threshold': {
      const parts: string[] = [];
      if (hasValue(actual)) {
        parts.push(`价格 ${formatCents(actual)}`);
      }
      if (hasValue(threshold)) {
        parts.push(`阈值 ${formatCents(threshold)}`);
      }
      return parts;
    }
    case 'price_change_pct':
    case 'price_change_5m':
      return hasValue(actual) ? [`波动 ${formatPercent(actual)}`] : [];
    case 'feed_stale':
      return [lag ? `${lag}未更新` : '行情未更新'];
    case 'system_error':
      return ['监控链路异常'];
    default: {
      const fact = buildFacts(alert)[0];
      return fact ? [`${fact.label} ${fact.value}`] : [];
    }
  }
};

const buildNotificationSnapshotValue = (alert: AlertPresentationSource) => {
  const snapshot = alert.marketSnapshot;
  const key = getAlertKey(alert);

  if (key === 'price_threshold' && hasValue(snapshot?.spread)) {
    return `当前价差 ${formatCents(snapshot.spread)}`;
  }

  if (hasValue(snapshot?.yesPrice)) {
    return `当前价格 ${formatCents(snapshot?.yesPrice)}`;
  }
  if (hasValue(snapshot?.spread)) {
    return `当前价差 ${formatCents(snapshot?.spread)}`;
  }
  return null;
};

export const buildAlertNotificationContent = (
  alert: AlertPresentationSource,
): AlertNotificationContent => {
  const ruleLabel = getRuleLabel(alert);
  const title = buildLocationLine(alert);
  const body = [ruleLabel, ...buildNotificationValueParts(alert), buildNotificationSnapshotValue(alert)]
    .filter((value): value is string => Boolean(value))
    .join(' · ');

  return {
    title: title || ruleLabel,
    body: body || buildReadableSummary(alert),
  };
};

export const buildAlertSummary = buildReadableSummary;

export const buildAlertDetail = buildReadableDetail;

export const buildAlertTitle = (alert: AlertPresentationSource) => buildLocationLine(alert);

export const buildAlertHeadline = buildAlertTitle;

export const buildAlertPresentation = (alert: AlertPresentationSource): AlertPresentation => ({
  alertLabel: '告警',
  cityLabel: getAlertCityLabel(alert),
  ruleLabel: getRuleLabel(alert),
  title: buildAlertTitle(alert),
  summary: buildReadableSummary(alert),
  detail: buildReadableDetail(alert),
  facts: buildFacts(alert),
  context: buildContext(alert),
});
