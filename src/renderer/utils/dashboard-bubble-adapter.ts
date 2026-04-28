import type { AlertEvent, AppHealth, CityBubbleSummary } from '../types/contracts';
import { formatTemperatureBandLabel, normalizeBandText } from './market-display';

export type BubbleRegion = 'NA' | 'EU' | 'ASIA' | 'OTHER';

export interface DashboardBubbleCityData {
  id: string;
  cityKey: string;
  eventDate: string;
  name: string;
  code: string;
  region: BubbleRegion;
  riskLevel: number;
  status_level: 'NORMAL' | 'WARNING' | 'CRITICAL';
  is_new_alert: boolean;
  alertCount: number;
  temperature: number;
  trend: 'up' | 'down' | 'stable';
  lastUpdated: string;
  dominantTemperatureBand: string;
  dominantYesPrice: number | null;
}

export interface PhysicsBubbleCityData {
  id: string;
  cityKey: string;
  eventDate: string;
  name: string;
  code: string;
  region: BubbleRegion;
  riskLevel: number;
  visualRadius: number;
}

export interface DashboardBubbleStats {
  totalAlerts: number;
  highRiskCount: number;
  visibleCityCount: number;
  coveredMarketCount: number;
  selectedDate: string;
  latencyMs: number;
  monitorStatusText: string;
}

export const buildDashboardBubbleId = (cityKey: string, eventDate: string) =>
  `${eventDate}::${cityKey}`;

const RECENT_ALERT_WINDOW_MS = 120_000;

const CITY_REGION_MAP: Record<string, BubbleRegion> = {
  amsterdam: 'EU',
  ankara: 'EU',
  atlanta: 'NA',
  austin: 'NA',
  beijing: 'ASIA',
  'buenos-aires': 'OTHER',
  busan: 'ASIA',
  'cape-town': 'OTHER',
  chengdu: 'ASIA',
  chicago: 'NA',
  chongqing: 'ASIA',
  dallas: 'NA',
  denver: 'NA',
  guangzhou: 'ASIA',
  helsinki: 'EU',
  'hong-kong': 'ASIA',
  houston: 'NA',
  istanbul: 'EU',
  jakarta: 'ASIA',
  jeddah: 'ASIA',
  'kuala-lumpur': 'ASIA',
  lagos: 'OTHER',
  london: 'EU',
  'los-angeles': 'NA',
  lucknow: 'ASIA',
  madrid: 'EU',
  'mexico-city': 'NA',
  miami: 'NA',
  milan: 'EU',
  moscow: 'EU',
  munich: 'EU',
  nyc: 'NA',
  'panama-city': 'NA',
  paris: 'EU',
  'san-francisco': 'NA',
  'sao-paulo': 'OTHER',
  seattle: 'NA',
  seoul: 'ASIA',
  shanghai: 'ASIA',
  shenzhen: 'ASIA',
  singapore: 'ASIA',
  taipei: 'ASIA',
  'tel-aviv': 'ASIA',
  tokyo: 'ASIA',
  toronto: 'NA',
  warsaw: 'EU',
  wellington: 'OTHER',
  wuhan: 'ASIA',
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const clampFinite = (value: number | null | undefined, min: number, max: number, fallback: number) => {
  const numeric = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return clamp(fallback, min, max);
  }
  return clamp(numeric, min, max);
};

const BUBBLE_MIN_RADIUS = 22;
const BUBBLE_MAX_RADIUS = 54;

const buildVisualRadius = (riskLevel: number) => {
  const normalized = clampFinite(riskLevel, 0, 100, 0) / 100;
  return Number(
    (
      BUBBLE_MIN_RADIUS +
      Math.sqrt(normalized) * (BUBBLE_MAX_RADIUS - BUBBLE_MIN_RADIUS)
    ).toFixed(2),
  );
};

const buildRiskLevel = (score: number | null | undefined) =>
  Math.round(clampFinite(score, 0, 100, 0));

const resolveRegion = (cityKey: string): BubbleRegion => CITY_REGION_MAP[cityKey] ?? 'OTHER';

const buildCodeFallback = (cityKey: string, cityName: string): string => {
  const fromKey = cityKey
    .split('-')
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

  if (fromKey.length >= 2) {
    return fromKey.slice(0, 4);
  }

  const fromName = cityName
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

  return fromName.slice(0, 4) || cityKey.slice(0, 4).toUpperCase();
};

const resolveCode = (row: CityBubbleSummary): string =>
  (row.airportCode?.trim() || buildCodeFallback(row.cityKey, row.cityName)).toUpperCase();

const parseTemperature = (temperatureBand: string): number => {
  const normalized = normalizeBandText(temperatureBand);
  const matches = normalized.match(/-?\d+(?:\.\d+)?/g) ?? [];
  if (matches.length === 0) {
    return 0;
  }

  const numbers = matches
    .map((item) => Number(item))
    .filter((value) => Number.isFinite(value));

  if (numbers.length === 0) {
    return 0;
  }

  if (numbers.length === 1) {
    return Math.round(numbers[0]);
  }

  return Math.round((numbers[0] + numbers[1]) / 2);
};

const resolveTrend = (change5m: number | undefined): DashboardBubbleCityData['trend'] => {
  if (typeof change5m !== 'number' || !Number.isFinite(change5m)) {
    return 'stable';
  }
  if (change5m >= 0.5) {
    return 'up';
  }
  if (change5m <= -0.5) {
    return 'down';
  }
  return 'stable';
};

const resolveStatusLevel = (
  severity: CityBubbleSummary['cityBubbleSeverity'],
): DashboardBubbleCityData['status_level'] => {
  if (severity === 'critical') {
    return 'CRITICAL';
  }
  if (severity === 'warning') {
    return 'WARNING';
  }
  return 'NORMAL';
};

const buildRecentAlertMap = (alerts: AlertEvent[], nowMs: number): Map<string, number> => {
  const byCityKey = new Map<string, number>();
  for (const alert of alerts) {
    if (!alert.cityKey) {
      continue;
    }

    const triggeredAtMs = Date.parse(alert.triggeredAt);
    if (!Number.isFinite(triggeredAtMs)) {
      continue;
    }

    const current = byCityKey.get(alert.cityKey) ?? 0;
    if (triggeredAtMs > current) {
      byCityKey.set(alert.cityKey, triggeredAtMs);
    }
  }

  for (const [cityKey, triggeredAtMs] of byCityKey.entries()) {
    if (nowMs - triggeredAtMs > RECENT_ALERT_WINDOW_MS) {
      byCityKey.delete(cityKey);
    }
  }

  return byCityKey;
};

const isReadableChineseText = (value?: string | null) => {
  const text = value?.trim() ?? '';
  return /[\u3400-\u9fff]/.test(text) && !/[A-Za-z]/.test(text);
};

const inferMonitorStatusText = (health: AppHealth) => {
  if (health.connected) {
    return '监控运行中';
  }

  const diagnostic = health.diagnostic?.trim();
  if (isReadableChineseText(diagnostic)) {
    return diagnostic ?? '监控连接中';
  }

  switch (health.errorSource) {
    case 'ws':
      return '实时连接异常';
    case 'db':
      return '本地数据服务异常';
    case 'discovery':
      return '发现服务异常';
    case 'packaging':
      return '运行资源缺失';
    case 'network':
      return '网络连接异常';
    case 'startup':
      return '启动流程异常';
    case 'worker':
      return '后台任务异常';
    default:
      break;
  }

  const normalized = diagnostic?.toLowerCase() ?? '';
  if (!normalized) {
    return '监控连接中';
  }

  if (normalized.includes('websocket') || normalized.includes(' ws ')) {
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
    normalized.includes('network') ||
    normalized.includes('proxy') ||
    normalized.includes('tls') ||
    normalized.includes('econn') ||
    normalized.includes('enotfound') ||
    normalized.includes('etimedout')
  ) {
    return '网络连接异常';
  }

  if (normalized.includes('timeout')) {
    return '请求超时';
  }

  if (
    normalized.includes('cannot find module') ||
    normalized.includes('packaged resources') ||
    normalized.includes('err_module_not_found')
  ) {
    return '运行资源缺失';
  }

  if (normalized.includes('permission') || normalized.includes('denied')) {
    return '权限不足';
  }

  return '监控连接中';
};

export const buildDashboardBubbleData = (
  rows: CityBubbleSummary[],
  alerts: AlertEvent[],
  nowMs = Date.now(),
): DashboardBubbleCityData[] => {
  const recentAlerts = buildRecentAlertMap(alerts, nowMs);

  return rows.map((row) => {
    const dominantMarket = row.topMarkets[0];

    return {
      id: buildDashboardBubbleId(row.cityKey, row.eventDate),
      cityKey: row.cityKey,
      eventDate: row.eventDate,
      name: row.cityName,
      code: resolveCode(row),
      region: resolveRegion(row.cityKey),
      riskLevel: buildRiskLevel(row.cityBubbleScore),
      status_level: resolveStatusLevel(row.cityBubbleSeverity),
      is_new_alert: recentAlerts.has(row.cityKey),
      alertCount: row.unackedAlertCount,
      temperature: parseTemperature(row.dominantTemperatureBand),
      trend: resolveTrend(dominantMarket?.change5m),
      lastUpdated: row.updatedAt,
      dominantTemperatureBand: formatTemperatureBandLabel(row.dominantTemperatureBand),
      dominantYesPrice: row.dominantYesPrice,
    };
  });
};

export const buildDashboardBubblePhysicsData = (
  rows: CityBubbleSummary[],
): PhysicsBubbleCityData[] =>
  rows.map((row) => {
    const riskLevel = buildRiskLevel(row.cityBubbleScore);

    return {
      id: buildDashboardBubbleId(row.cityKey, row.eventDate),
      cityKey: row.cityKey,
      eventDate: row.eventDate,
      name: row.cityName,
      code: resolveCode(row),
      region: resolveRegion(row.cityKey),
      riskLevel,
      visualRadius: buildVisualRadius(riskLevel),
    };
  });

export const buildBubblePhysicsSignature = (
  rows: ReadonlyArray<Pick<PhysicsBubbleCityData, 'id'>>,
  options?: {
    layoutKey?: string;
    filterMode?: string;
    regionFilter?: string;
    bubblePadding?: number;
  },
) => {
  const ids = rows
    .map((row) => row.id)
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .join('|');
  const bubblePadding =
    typeof options?.bubblePadding === 'number' && Number.isFinite(options.bubblePadding)
      ? options.bubblePadding.toFixed(2)
      : '';

  return [
    options?.layoutKey ?? '',
    options?.filterMode ?? '',
    options?.regionFilter ?? '',
    bubblePadding,
    ids,
  ].join('::');
};

export const buildDashboardBubbleStats = (
  cities: DashboardBubbleCityData[],
  health: AppHealth,
  coveredMarketCount: number,
  selectedDate: string,
): DashboardBubbleStats => {
  const totalAlerts = cities.reduce((sum, city) => sum + city.alertCount, 0);
  const highRiskCount = cities.filter((city) => city.status_level === 'CRITICAL').length;
  const monitorStatusText = inferMonitorStatusText(health);

  return {
    totalAlerts,
    highRiskCount,
    visibleCityCount: cities.length,
    coveredMarketCount,
    selectedDate,
    latencyMs: health.latencyMs,
    monitorStatusText,
  };
};
