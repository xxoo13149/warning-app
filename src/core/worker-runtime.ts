import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MessagePort } from 'node:worker_threads';

import { AlertEngine } from './alerts/engine';
import type { AlertRule as EngineAlertRule, AlertSeverity, AlertTrigger } from './alerts/types';
import {
  ALERT_EVENT_PAGE_LIMIT_DEFAULT,
  ALERT_EVENT_PAGE_LIMIT_MAX,
  WeatherMonitorRepository,
  type AlertEventQuery,
} from './db/repository';
import type {
  AlertEventRow as DbAlertEventRow,
  CityConfig as DbCityConfig,
  LatestTokenState as DbLatestTokenState,
  NewPriceTick,
  TrackedMarket as DbTrackedMarket,
} from './db/schema';
import type {
  MarketPriceSeed,
  NormalizedEvent,
  ShardStatusEvent,
  TokenRuntimeState,
} from './polymarket/types';
import { PolymarketDataService } from './services/polymarket-data-service';
import { FeedStateStore, MarketStateStore, type MarketTickSnapshot } from './state/market-state';
import {
  formatAlertMessage,
  formatBuiltinRuleName,
  type AlertMarketSnapshot,
  type BuiltinRuleKey,
} from '../shared/alert-display';
import { DEFAULT_CITY_CONFIGS } from '../shared/city-seeds';
import {
  DEFAULT_ALERT_RETENTION_DAYS,
  DEFAULT_TICK_RETENTION_DAYS,
  MAX_ALERT_RETENTION_DAYS,
  MAX_TICK_RETENTION_DAYS,
  MIN_ALERT_RETENTION_DAYS,
  MIN_TICK_RETENTION_DAYS,
} from '../shared/constants';
import {
  BUILTIN_DEFAULT_SOUND_ID,
  BUILTIN_SOUND_LIBRARY,
  toBuiltinSoundPath,
} from '../shared/sound-library';
import type {
  WorkerBootstrapData,
  WorkerInvokeChannel,
  WorkerInvokePayloadMap,
  WorkerInvokeResultMap,
  WorkerRequest,
  WorkerResponse,
} from '../shared/worker-protocol';
import { cityConfigArraySchema } from '../shared/schemas';
import type {
  AlertEvent,
  AlertListCursor,
  AlertListResult,
  AlertRule,
  AppHealth,
  AppSettings,
  DashboardQuery,
  DashboardSnapshot,
  DashboardTickPayload,
  HealthErrorSource,
  LotteryConfirmationSource,
  MarketQuery,
  MarketQueryResult,
  MarketRow,
  RegisterSoundPayload,
  RulePreviewResult,
  SettingsPayload,
  StorageMaintenanceResult,
  StorageMaintenanceSummary,
  SoundProfile,
} from '../shared/monitor-contracts';
import { DEFAULT_HEALTH, DEFAULT_SETTINGS } from '../main/contracts/ipc';

const APP_SETTING_KEYS = {
  startOnBoot: 'startOnBoot',
  backgroundAudio: 'backgroundAudio',
  reconnectPolicy: 'reconnectPolicy',
  pollIntervalSec: 'pollIntervalSec',
  tickRetentionDays: 'tickRetentionDays',
  alertRetentionDays: 'alertRetentionDays',
  selectedSoundProfileId: 'selectedSoundProfileId',
  quietHoursStart: 'quietHoursStart',
  quietHoursEnd: 'quietHoursEnd',
} as const;

type RuleSavePayload = WorkerInvokePayloadMap['rules.save'];
type RulePreviewPayload = WorkerInvokePayloadMap['rules.preview'];

const BUILTIN_RULE_DISPLAY_NAMES_ZH: Record<BuiltinRuleKey, string> = {
  feed_stale: '数据流停滞',
  liquidity_kill: '盘口斩杀',
  volume_pricing: '带量定价',
  spread_threshold: '价差过宽',
  price_change_5m: '5分钟异动',
};

interface TokenMeta {
  marketId: string;
  cityKey: string;
  eventId: string;
  eventDate: string;
  temperatureBand: string;
  seriesSlug: string;
  side: 'yes' | 'no';
}

interface PriceWindowEntry {
  timestamp: number;
  price: number;
}

interface BubbleSnapshot {
  score: number;
  severity: MarketRow['bubbleSeverity'];
}

interface LotterySignalSnapshot {
  referenceAsk: number;
  currentAsk: number;
  lift: number;
  confirmationSource: LotteryConfirmationSource;
  effectiveSize: number;
  effectiveNotional: number;
  updatedAt: string;
}

type DashboardUnackedAlertRow = Pick<
  DbAlertEventRow,
  'id' | 'ruleId' | 'builtinKey' | 'triggeredAt' | 'cityKey' | 'marketId' | 'acknowledged'
>;

type BubbleAlertRow = Pick<
  DbAlertEventRow,
  'id' | 'ruleId' | 'builtinKey' | 'triggeredAt' | 'marketId'
>;

const EMPTY_HEALTH: AppHealth = { ...DEFAULT_HEALTH };

const UI_RULES_SEED: AlertRule[] = [
  {
    id: 'price-change-5m',
    name: formatBuiltinRuleName('price_change_5m', 'zh-CN') ?? '5分钟异动',
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
    soundProfileId: '',
    scope: {},
  },
  {
    id: 'spread-threshold',
    name: formatBuiltinRuleName('spread_threshold', 'zh-CN') ?? '价差过宽',
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
    soundProfileId: '',
    scope: {},
  },
  {
    id: 'feed-stale',
    name: formatBuiltinRuleName('feed_stale', 'zh-CN') ?? '数据流停滞',
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
    soundProfileId: '',
    scope: {},
  },
  {
    id: 'liquidity-kill',
    name: formatBuiltinRuleName('liquidity_kill', 'zh-CN') ?? '盘口斩杀',
    isBuiltin: true,
    builtinKey: 'liquidity_kill',
    metric: 'liquidity_kill',
    operator: '>=',
    threshold: 0.2,
    windowSec: 30,
    cooldownSec: 120,
    dedupeWindowSec: 60,
    bubbleWeight: 90,
    severity: 'critical',
    enabled: true,
    soundProfileId: '',
    liquiditySide: 'both',
    scope: {},
  },
  {
    id: 'volume-pricing',
    name: formatBuiltinRuleName('volume_pricing', 'zh-CN') ?? '带量定价',
    isBuiltin: true,
    builtinKey: 'volume_pricing',
    metric: 'volume_pricing',
    operator: '>=',
    threshold: 0.1,
    windowSec: 60,
    cooldownSec: 180,
    dedupeWindowSec: 60,
    bubbleWeight: 80,
    severity: 'warning',
    enabled: true,
    soundProfileId: '',
    scope: {},
  },
];

const severityToUi = (severity: AlertSeverity): AlertEvent['severity'] => {
  if (severity === 'critical') return 'critical';
  if (severity === 'high' || severity === 'medium') return 'warning';
  return 'info';
};

type EmittedAlertSource = Exclude<AlertEvent['source'], undefined>;

const toTokenAlertSource = (lastEventType?: string): EmittedAlertSource => {
  if (lastEventType === 'discovery') {
    return 'discovery-seed';
  }
  if (lastEventType === 'snapshot') {
    return 'snapshot-backfill';
  }
  return 'realtime';
};

const uiToEngineSeverity = (severity: AlertRule['severity']): AlertSeverity => {
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'medium';
  return 'low';
};

const parseTimeToMinutes = (value: string): number => {
  const [hours, minutes] = value.split(':').map((item) => Number(item));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return 0;
  }
  return hours * 60 + minutes;
};

const parseAlertListCursor = (
  cursor: AlertListCursor | undefined,
): { triggeredAt: number; id: string } | undefined => {
  const triggeredAt = cursor?.triggeredAt?.trim();
  const id = cursor?.id?.trim();
  if (!triggeredAt || !id) {
    return undefined;
  }

  const triggeredAtMs = Date.parse(triggeredAt);
  if (!Number.isFinite(triggeredAtMs)) {
    return undefined;
  }

  return {
    triggeredAt: triggeredAtMs,
    id,
  };
};

const toAlertListCursor = (
  cursor: { triggeredAt: number; id: string } | undefined,
): AlertListCursor | undefined =>
  cursor
    ? {
        triggeredAt: new Date(cursor.triggeredAt).toISOString(),
        id: cursor.id,
      }
    : undefined;

const toDbCityConfig = (city: {
  cityKey: string;
  displayName: string;
  seriesSlug: string;
  airportCode?: string | null;
  timezone?: string | null;
  enabled: boolean;
  resolutionSourceOverride?: string | null;
}) => ({
  cityKey: city.cityKey,
  displayName: city.displayName,
  seriesSlug: city.seriesSlug,
  airportCode: city.airportCode ?? '',
  timezone: city.timezone ?? 'UTC',
  enabled: city.enabled,
  resolutionSourceOverride: city.resolutionSourceOverride ?? null,
});

const toRuntimeCityConfig = (city: DbCityConfig) => ({
  cityKey: city.cityKey,
  displayName: city.displayName,
  seriesSlug: city.seriesSlug,
  airportCode: city.airportCode,
  timezone: city.timezone,
  enabled: city.enabled,
  resolutionSourceOverride: city.resolutionSourceOverride ?? undefined,
});

const normalizeRuleSavePayload = (payload: RuleSavePayload): AlertRule[] =>
  Array.isArray(payload) ? payload : payload.rules;

const clampSoundGain = (value: number | undefined, fallback = 1): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(value, 1));
};

const normalizeTickRetentionDays = (value: number | string | undefined): number => {
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TICK_RETENTION_DAYS;
  }
  return Math.max(
    MIN_TICK_RETENTION_DAYS,
    Math.min(MAX_TICK_RETENTION_DAYS, Math.trunc(parsed)),
  );
};

const normalizeAlertRetentionDays = (value: number | string | undefined): number => {
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_ALERT_RETENTION_DAYS;
  }
  return Math.max(
    MIN_ALERT_RETENTION_DAYS,
    Math.min(MAX_ALERT_RETENTION_DAYS, Math.trunc(parsed)),
  );
};

type TickArchiveMaintenanceResult =
  | number
  | {
      archivedRows?: number;
      archivedTickRows?: number;
      archivedRawTicks?: number;
      prunedRows?: number;
      removedRows?: number;
      deletedRows?: number;
      aggregateRows?: number;
      hasMore?: boolean;
      checkpointSuggested?: boolean;
      compactSuggested?: boolean;
    };

interface TickArchiveMaintenanceQuery {
  cutoffTimestamp: number;
  batchSize?: number;
}

type TickArchiveMaintenanceRepository = WeatherMonitorRepository & {
  archivePriceTicks?: (query: number | TickArchiveMaintenanceQuery) => TickArchiveMaintenanceResult;
  archiveAndPrunePriceTicks?: (retentionDays: number) => TickArchiveMaintenanceResult;
  maintainPriceTickArchive?: (retentionDays: number) => TickArchiveMaintenanceResult;
  maintainPriceTicks?: (retentionDays: number) => TickArchiveMaintenanceResult;
};

const normalizeMaintenanceRowCount = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;

const normalizeTickArchiveMaintenanceResult = (
  result: TickArchiveMaintenanceResult,
): {
  archivedRows: number;
  prunedRows: number;
  aggregateRows: number;
  changedRows: number;
  hasMore: boolean;
  compactSuggested: boolean;
  checkpointSuggested: boolean;
} => {
  if (typeof result === 'number') {
    const prunedRows = normalizeMaintenanceRowCount(result);
    return {
      archivedRows: 0,
      prunedRows,
      aggregateRows: 0,
      changedRows: prunedRows,
      hasMore: false,
      compactSuggested: false,
      checkpointSuggested: prunedRows > 0,
    };
  }

  const archivedRows = normalizeMaintenanceRowCount(
    result.archivedRows ?? result.archivedTickRows ?? result.archivedRawTicks,
  );
  const prunedRows = normalizeMaintenanceRowCount(
    result.prunedRows ?? result.removedRows ?? result.deletedRows,
  );
  const aggregateRows = normalizeMaintenanceRowCount(result.aggregateRows);
  return {
    archivedRows,
    prunedRows,
    aggregateRows,
    changedRows: archivedRows + prunedRows + aggregateRows,
    hasMore: result.hasMore === true,
    compactSuggested: result.compactSuggested === true,
    checkpointSuggested: result.checkpointSuggested === true || archivedRows > 0 || prunedRows > 0,
  };
};

interface TickArchiveMaintenanceRunSummary {
  changedRows: number;
  archivedRows: number;
  prunedRows: number;
  aggregateRows: number;
  checkpointed: boolean;
  compacted: boolean;
}

interface AlertHistoryMaintenanceRunSummary {
  prunedRows: number;
  checkpointed: boolean;
  compacted: boolean;
}

const createDefaultStorageMaintenanceSummary = (): StorageMaintenanceSummary => ({
  status: 'idle',
  lastRunAt: null,
  lastSuccessAt: null,
  lastDurationMs: null,
  lastArchivedRows: 0,
  lastPrunedTickRows: 0,
  lastPrunedAlertRows: 0,
  lastCheckpointAt: null,
  lastCompactionAt: null,
  lastReason: null,
  lastError: null,
});

const toEngineScopeSide = (
  side: 'YES' | 'NO' | 'BOTH' | undefined,
): 'yes' | 'no' | undefined => {
  if (side === 'YES') return 'yes';
  if (side === 'NO') return 'no';
  return undefined;
};

const toUiScopeSide = (side: 'yes' | 'no' | undefined): 'YES' | 'NO' | 'BOTH' => {
  if (side === 'yes') return 'YES';
  if (side === 'no') return 'NO';
  return 'BOTH';
};

const DISPLAY_MIDPOINT_MAX_SPREAD = 0.1;

const normalizeOptionalNumber = (
  value: number | null | undefined,
): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const sameOptionalNumber = (
  left: number | null | undefined,
  right: number | null | undefined,
): boolean => normalizeOptionalNumber(left) === normalizeOptionalNumber(right);

const resolveSpread = (
  bestBid: number | null | undefined,
  bestAsk: number | null | undefined,
): number | null => {
  const bid = normalizeOptionalNumber(bestBid);
  const ask = normalizeOptionalNumber(bestAsk);
  return bid !== undefined && ask !== undefined ? Math.max(0, ask - bid) : null;
};

const resolveDisplayPrice = (
  lastTradePrice: number | null | undefined,
  bestBid: number | null | undefined,
  bestAsk: number | null | undefined,
): number | null => {
  const trade = normalizeOptionalNumber(lastTradePrice);
  if (trade !== undefined) {
    return trade;
  }

  const bid = normalizeOptionalNumber(bestBid);
  const ask = normalizeOptionalNumber(bestAsk);
  if (bid !== undefined && ask !== undefined) {
    const spread = Math.max(0, ask - bid);
    return spread <= DISPLAY_MIDPOINT_MAX_SPREAD
      ? Number(((bid + ask) / 2).toFixed(6))
      : bid;
  }

  return bid ?? ask ?? null;
};

const complementPrice = (price: number | null): number | null =>
  price === null ? null : Number(Math.max(0, Math.min(1, 1 - price)).toFixed(6));

const buildQuietHoursFromSettings = (
  settings: Pick<AppSettings, 'quietHoursStart' | 'quietHoursEnd'>,
): EngineAlertRule['quietHours'] => ({
  startMinute: parseTimeToMinutes(settings.quietHoursStart),
  endMinute: parseTimeToMinutes(settings.quietHoursEnd),
});

const isSameQuietHours = (
  left: EngineAlertRule['quietHours'] | undefined,
  right: EngineAlertRule['quietHours'] | undefined,
) =>
  left?.startMinute === right?.startMinute && left?.endMinute === right?.endMinute;

const MARKET_TICK_EMIT_INTERVAL_MS = 140;
const DASHBOARD_TICK_EMIT_INTERVAL_MS = 220;
const PRICE_TICK_BATCH_INTERVAL_MS = 500;
const PRICE_TICK_BATCH_LIMIT = 64;
const PRICE_CHANGE_WINDOW_MS = 5 * 60 * 1000;
const PRICE_CHANGE_WINDOW_MAX_ENTRIES = 240;
const LOTTERY_SIGNAL_WINDOW_MS = 60 * 1000;
const LOTTERY_SIGNAL_DEFAULT_MIN_LIFT = 0.05;
const LOTTERY_SIGNAL_REFERENCE_ASK_MAX = 0.04;
const LOTTERY_SIGNAL_CURRENT_ASK_MAX = 0.18;
const LOTTERY_SIGNAL_MAX_SPREAD = 0.1;
const LOTTERY_SIGNAL_FRESH_MS = 30_000;
const LOTTERY_SIGNAL_MIN_NOTIONAL = 5;
const LOTTERY_SIGNAL_MIN_SIZE = 100;
const LOTTERY_SIGNAL_TRADE_TOLERANCE = 0.02;
const MAINTENANCE_INTERVAL_MS = 30 * 60 * 1000;
const STARTUP_MAINTENANCE_DELAY_MS = 15_000;
const TICK_ARCHIVE_BATCH_SIZE = 50_000;
const MAX_TICK_ARCHIVE_BATCHES_PER_RUN = 80;
const BUBBLE_SCORE_RECOMPUTE_INTERVAL_MS = 60 * 1000;
const BUBBLE_ALERT_HISTORY_START_MS = 0;
const BUBBLE_STRONG_ALERT_WINDOW_MS = 60 * 60 * 1000;
const BUBBLE_WEAK_SCORE_MULTIPLIER = 0.45;
const BUBBLE_SCORE_MAX = 100;
const DASHBOARD_MAX_VISIBLE_CITIES = 48;
const CUSTOM_RULE_BUBBLE_WEIGHT = 60;
const CURRENT_RULE_SCAN_ALERT_LIMIT = 80;
const STARTUP_RULE_SCAN_MAX_STATE_AGE_MS = 90 * 1000;
const STORAGE_COMPACTION_PRUNE_THRESHOLD = 10_000;
const MARKET_HISTORY_REQUIRED_METRICS = new Set<EngineAlertRule['metric']>([
  'price_change_pct',
  'liquidity_kill',
  'volume_pricing',
]);
const BUBBLE_WEIGHT_DEFAULTS: Record<BuiltinRuleKey, number> = {
  feed_stale: 95,
  liquidity_kill: 90,
  volume_pricing: 80,
  spread_threshold: 70,
  price_change_5m: 55,
};
const BUBBLE_SEVERITY_RANK: Record<MarketRow['bubbleSeverity'], number> = {
  none: 0,
  info: 1,
  warning: 2,
  critical: 3,
};
const MARKET_SEARCH_SEPARATOR_PATTERN = /[\s_-]+/g;
const MARKET_CITY_SEARCH_ALIASES: Record<string, string[]> = {
  amsterdam: ['ams', '阿姆斯特丹'],
  ankara: ['esb', '安卡拉'],
  atlanta: ['atl', '亚特兰大'],
  austin: ['aus', '奥斯汀'],
  beijing: ['pek', 'pkx', '北京'],
  busan: ['pus', '釜山'],
  'buenos-aires': ['eze', 'aep', '布宜诺斯艾利斯'],
  'cape-town': ['cpt', '开普敦'],
  chengdu: ['ctu', 'tfu', '成都'],
  chicago: ['ord', 'mdw', '芝加哥'],
  chongqing: ['ckg', '重庆', '重慶'],
  dallas: ['dfw', 'dal', '达拉斯'],
  denver: ['den', '丹佛'],
  guangzhou: ['can', '广州', '廣州', 'baiyun'],
  helsinki: ['hel', '赫尔辛基'],
  'hong-kong': ['hkg', '香港'],
  houston: ['iah', 'hou', '休斯敦'],
  istanbul: ['ist', '伊斯坦布尔'],
  jakarta: ['cgk', '雅加达'],
  jeddah: ['jed', '吉达'],
  'kuala-lumpur': ['kul', '吉隆坡'],
  lagos: ['los', '拉各斯'],
  london: ['lhr', 'lgw', 'lcy', '伦敦'],
  'los-angeles': ['lax', '洛杉矶'],
  lucknow: ['lko', '勒克瑙'],
  madrid: ['mad', '马德里'],
  'mexico-city': ['mex', '墨西哥城'],
  miami: ['mia', '迈阿密'],
  milan: ['mxp', 'lin', '米兰'],
  moscow: ['svo', 'dme', '莫斯科'],
  munich: ['muc', '慕尼黑'],
  nyc: ['nyc', 'jfk', 'lga', 'ewr', 'new-york', 'new york', '纽约', '紐約'],
  'panama-city': ['pty', '巴拿马城'],
  paris: ['cdg', 'ory', '巴黎'],
  'san-francisco': ['sfo', '旧金山', '舊金山'],
  'sao-paulo': ['gru', '圣保罗', '聖保羅'],
  seattle: ['sea', '西雅图'],
  seoul: ['icn', 'gmp', '首尔', '首爾'],
  shanghai: ['pvg', 'sha', '上海'],
  shenzhen: ['szx', '深圳'],
  singapore: ['sin', '新加坡'],
  taipei: ['tpe', '台北'],
  'tel-aviv': ['tlv', '特拉维夫'],
  tokyo: ['tyo', 'hnd', 'nrt', '东京', '東京'],
  toronto: ['yyz', '多伦多'],
  warsaw: ['waw', '华沙'],
  wellington: ['wlg', '惠灵顿'],
  wuhan: ['wuh', '武汉', '武漢'],
};

const normalizeMarketSearchValue = (value: string | null | undefined): string =>
  (value ?? '').trim().toLocaleLowerCase();

const compactMarketSearchValue = (value: string): string =>
  normalizeMarketSearchValue(value).replace(MARKET_SEARCH_SEPARATOR_PATTERN, '');

const marketFieldMatchesSearch = (
  value: string | null | undefined,
  searchTerm: string,
  compactSearchTerm: string,
): boolean => {
  const normalized = normalizeMarketSearchValue(value);
  if (!normalized) {
    return false;
  }
  return normalized.includes(searchTerm) || compactMarketSearchValue(normalized).includes(compactSearchTerm);
};

const marketRowMatchesSearch = (row: MarketRow, rawSearchTerm: string): boolean => {
  const searchTerm = normalizeMarketSearchValue(rawSearchTerm);
  if (!searchTerm) {
    return true;
  }
  const compactSearchTerm = compactMarketSearchValue(searchTerm);
  const cityAliases =
    MARKET_CITY_SEARCH_ALIASES[row.cityKey] ??
    MARKET_CITY_SEARCH_ALIASES[compactMarketSearchValue(row.cityKey)] ??
    [];
  return [
    row.cityKey,
    row.cityName,
    row.airportCode,
    row.marketId,
    row.temperatureBand,
    ...cityAliases,
  ].some((value) => marketFieldMatchesSearch(value, searchTerm, compactSearchTerm));
};

const resolveRequiredMarketHistoryWindowMs = (
  rules: readonly Pick<EngineAlertRule, 'enabled' | 'metric' | 'windowSec'>[],
): number =>
  rules.reduce((maxWindowMs, rule) => {
    if (!rule.enabled || !MARKET_HISTORY_REQUIRED_METRICS.has(rule.metric)) {
      return maxWindowMs;
    }

    const windowSec =
      typeof rule.windowSec === 'number' && Number.isFinite(rule.windowSec)
        ? Math.max(0, Math.trunc(rule.windowSec))
        : 0;
    return Math.max(maxWindowMs, windowSec * 1000);
  }, 0);

const getTodayDateKey = (): string => new Date().toISOString().slice(0, 10);

const isDecisionUsefulMarketRow = (row: MarketRow, today: string): boolean =>
  row.status === 'active' && row.eventDate >= today;

const getMarketLifecycleRank = (row: MarketRow, today: string): number => {
  const isCurrentOrFuture = row.eventDate >= today;
  if (row.status === 'active' && isCurrentOrFuture) {
    return 0;
  }
  if (row.status === 'active') {
    return 1;
  }
  if (row.status === 'halted' && isCurrentOrFuture) {
    return 2;
  }
  if (row.status === 'halted') {
    return 3;
  }
  if (isCurrentOrFuture) {
    return 4;
  }
  return 5;
};

const compareMarketLifecycle = (left: MarketRow, right: MarketRow, today: string): number => {
  const rankDelta = getMarketLifecycleRank(left, today) - getMarketLifecycleRank(right, today);
  if (rankDelta !== 0) {
    return rankDelta;
  }
  if (left.eventDate !== right.eventDate) {
    return left.eventDate.localeCompare(right.eventDate);
  }
  return 0;
};

export class WorkerRuntime {
  private readonly port: MessagePort;
  private readonly repository: WeatherMonitorRepository;
  private readonly dataService: PolymarketDataService;
  private readonly marketState = new MarketStateStore(0);
  private readonly feedState = new FeedStateStore();
  private readonly alertEngine = new AlertEngine(this.marketState);

  private health: AppHealth = { ...EMPTY_HEALTH };
  private uiRules: AlertRule[] = [];
  private engineRules: EngineAlertRule[] = [];
  private tokenMetaById = new Map<string, TokenMeta>();
  private trackedMarketById = new Map<string, DbTrackedMarket>();
  private cityByKey = new Map<string, DbCityConfig>();
  private latestTokenStateById = new Map<string, DbLatestTokenState>();
  private pendingMarketTickById = new Map<string, MarketRow>();
  private pendingMarketTickTimer?: ReturnType<typeof setTimeout>;
  private pendingDashboardTickTimer?: ReturnType<typeof setTimeout>;
  private pendingPriceTicks: NewPriceTick[] = [];
  private priceTickFlushTimer?: ReturnType<typeof setTimeout>;
  private priceWindowByToken = new Map<string, PriceWindowEntry[]>();
  private latestBubbleAlertByMarketId = new Map<string, BubbleAlertRow>();
  private bubbleSnapshotByMarketId = new Map<string, BubbleSnapshot>();
  private unackedAlertById = new Map<string, DashboardUnackedAlertRow>();
  private unackedAlertCountByMarketId = new Map<string, number>();
  private unackedAlertCountByCityKey = new Map<string, number>();
  private latestUnackedAlertByMarketId = new Map<string, DashboardUnackedAlertRow>();
  private bubbleScoreUpdatedAt = new Date(0).toISOString();
  private bubbleScoreTimer?: ReturnType<typeof setInterval>;
  private serviceStarted = false;
  private serviceRetryTimer?: ReturnType<typeof setTimeout>;
  private maintenanceTimer?: ReturnType<typeof setInterval>;
  private startupMaintenanceTimer?: ReturnType<typeof setTimeout>;
  private maintenanceInFlight: Promise<StorageMaintenanceResult> | null = null;
  private maintenanceSummary: StorageMaintenanceSummary =
    createDefaultStorageMaintenanceSummary();
  private lastServiceError: string | null = null;
  private hasSuccessfulDiscovery = false;
  private startupRuleCheckCompleted = false;
  private primedLiveAlertTokenIds = new Set<string>();

  private lastServiceErrorSource: HealthErrorSource | null = null;

  private recordServiceError(source: HealthErrorSource, message: string | null): void {
    const normalized = message?.trim() ?? '';
    this.lastServiceError = normalized || null;
    this.lastServiceErrorSource = source;
  }

  private clearServiceError(): void {
    this.lastServiceError = null;
    this.lastServiceErrorSource = null;
  }

  constructor(port: MessagePort, bootstrapData: WorkerBootstrapData) {
    this.port = port;
    this.repository = new WeatherMonitorRepository({
      dbPath: bootstrapData.dbPath,
    });
    this.dataService = new PolymarketDataService({
      gamma: {
        proxyUrl: bootstrapData.proxyUrl ?? undefined,
      },
      clobRest: {
        proxyUrl: bootstrapData.proxyUrl ?? undefined,
      },
      ws: {
        proxyUrl: bootstrapData.proxyUrl ?? undefined,
      },
    });
  }

  async start(): Promise<void> {
    this.repository.init();
    this.repository.seedDefaults();
    this.seedCityConfigs();
    this.seedRules();
    this.seedBuiltinSounds();
    this.refreshIndexes();
    this.bindServiceEvents();
    await this.ensureDataServiceStarted();
    this.startMaintenanceLoop();
    await this.refreshRules();
    this.recomputeBubbleScores();
    this.startBubbleScoreLoop();
    await this.emitHealth();
  }

  async handleRequest<C extends WorkerInvokeChannel>(
    message: WorkerRequest<C>,
  ): Promise<void> {
    try {
      const payload = await this.dispatch(
        message.channel,
        message.payload as WorkerInvokePayloadMap[C],
      );
      this.respond({
        kind: 'response',
        id: message.id,
        ok: true,
        channel: message.channel,
        payload,
      } as WorkerResponse<C>);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.respond({
        kind: 'response',
        id: message.id,
        ok: false,
        channel: message.channel,
        error: reason,
      } as WorkerResponse<C>);
    }
  }

  private async dispatch<C extends WorkerInvokeChannel>(
    channel: C,
    payload: WorkerInvokePayloadMap[C],
  ): Promise<WorkerInvokeResultMap[C]> {
    switch (channel) {
      case 'app.getHealth':
        return (await this.getHealth()) as WorkerInvokeResultMap[C];
      case 'dashboard.query':
        return this.queryDashboard(payload as DashboardQuery | undefined) as WorkerInvokeResultMap[C];
      case 'markets.query':
        return this.queryMarkets(payload as MarketQuery | undefined) as WorkerInvokeResultMap[C];
      case 'alerts.list':
        return this.listAlerts(payload as WorkerInvokePayloadMap['alerts.list']) as WorkerInvokeResultMap[C];
      case 'alerts.ack':
        return this.ackAlerts(payload as WorkerInvokePayloadMap['alerts.ack']) as WorkerInvokeResultMap[C];
      case 'rules.list':
        return { rows: [...this.uiRules] } as WorkerInvokeResultMap[C];
      case 'rules.preview':
        return this.previewRule(payload as RulePreviewPayload) as WorkerInvokeResultMap[C];
      case 'rules.save':
        return this.saveRules(payload as RuleSavePayload) as WorkerInvokeResultMap[C];
      case 'storage.runMaintenance':
        return (await this.runStorageMaintenance('manual', {
          allowCompaction: true,
        })) as WorkerInvokeResultMap[C];
      case 'settings.get':
        return this.getSettingsPayload() as WorkerInvokeResultMap[C];
      case 'settings.update':
        return this.updateSettings(payload as Partial<AppSettings>) as WorkerInvokeResultMap[C];
      case 'settings.importCityMap':
        return (await this.importCityMap(
          payload as WorkerInvokePayloadMap['settings.importCityMap'],
        )) as WorkerInvokeResultMap[C];
      case 'settings.pickSound':
        return this.pickSound(
          payload as WorkerInvokePayloadMap['settings.pickSound'],
        ) as WorkerInvokeResultMap[C];
      case 'settings.registerSound':
        return this.registerSound(
          payload as WorkerInvokePayloadMap['settings.registerSound'],
        ) as WorkerInvokeResultMap[C];
      default:
        throw new Error(`Unsupported worker channel: ${String(channel)}`);
    }
  }

  private async getHealth(): Promise<AppHealth> {
    await this.emitHealth();
    return this.health;
  }

  private seedCityConfigs(): void {
    if (this.repository.queryCityConfigs().length > 0) {
      return;
    }
    this.repository.upsertCityConfigs(DEFAULT_CITY_CONFIGS.map(toDbCityConfig));
  }

  private seedRules(): void {
    const existingRules = this.repository.queryAlertRules(false).map(normalizeLegacyEngineRule);
    const existingRuleIds = new Set(existingRules.map((rule) => rule.id));
    const missingDefaultRules = UI_RULES_SEED
      .filter((rule) => !existingRuleIds.has(rule.id))
      .map((rule) => mapUiRuleToEngine(rule));

    if (missingDefaultRules.length > 0) {
      this.repository.upsertAlertRules(missingDefaultRules);
    }

    this.refreshRulesSync();
  }

  private seedBuiltinSounds(): void {
    const soundProfiles = BUILTIN_SOUND_LIBRARY.map((sound) => ({
      id: sound.id,
      name: sound.nameZh,
      filePath: toBuiltinSoundPath(sound.id),
      volume: clampSoundGain(sound.gain, 1),
      enabled: true,
      isBuiltin: true,
      isDefault: sound.id === BUILTIN_DEFAULT_SOUND_ID,
    }));

    this.repository.upsertSoundProfiles(soundProfiles);

    const settings = this.readSettings();
    if (!settings.selectedSoundProfileId) {
      this.writeSettings({
        ...settings,
        selectedSoundProfileId: BUILTIN_DEFAULT_SOUND_ID,
      });
    }
  }

  private async ensureDataServiceStarted(): Promise<void> {
    if (this.serviceStarted) {
      return;
    }

    try {
      await this.dataService.start({
        cityConfigs: this.repository.queryCityConfigs(true).map(toRuntimeCityConfig),
      });
      this.serviceStarted = true;
      this.clearServiceError();
    } catch (error) {
      this.serviceStarted = false;
      const message = error instanceof Error ? error.message : String(error);
      this.recordServiceError('startup', message);
      await this.dataService.stop().catch(() => undefined);
      await this.emitHealth();
      this.scheduleServiceRetry();
      console.error('[worker-runtime] data service start failed', error);
    }
  }

  private scheduleServiceRetry(): void {
    if (this.serviceRetryTimer) {
      return;
    }

    this.serviceRetryTimer = setTimeout(() => {
      this.serviceRetryTimer = undefined;
      void this.ensureDataServiceStarted();
    }, 30_000);
    this.serviceRetryTimer.unref();
  }

  private async refreshRules(): Promise<void> {
    this.refreshRulesSync();
  }

  private refreshRulesSync(): void {
    const settings = this.readSettings();
    const storedRules = this.repository.queryAlertRules(false).map(normalizeLegacyEngineRule);
    this.applyUiRules(storedRules.map((rule) => mapEngineRuleToUi(rule, settings)));
    this.repository.upsertAlertRules(this.engineRules);
  }

  private applyUiRules(nextUiRules: AlertRule[]): void {
    this.uiRules = nextUiRules;
    this.engineRules = nextUiRules.map((rule) => mapUiRuleToEngine(rule));
    this.marketState.setHistoryWindow(
      Math.max(LOTTERY_SIGNAL_WINDOW_MS, resolveRequiredMarketHistoryWindowMs(this.engineRules)),
    );
  }

  private startBubbleScoreLoop(): void {
    if (this.bubbleScoreTimer) {
      return;
    }
    this.bubbleScoreTimer = setInterval(() => {
      const computedAt = Date.now();
      const changedMarketIds = this.recomputeBubbleScores(
        Array.from(this.latestBubbleAlertByMarketId.entries())
          .filter(([marketId, alert]) => {
            const snapshot = this.bubbleSnapshotByMarketId.get(marketId);
            return (
              snapshot?.severity === 'critical' &&
              computedAt - alert.triggeredAt > BUBBLE_STRONG_ALERT_WINDOW_MS
            );
          })
          .map(([marketId]) => marketId),
        computedAt,
      );
      if (changedMarketIds.length > 0) {
        this.emitBubbleScoreTicks(changedMarketIds);
      }
    }, BUBBLE_SCORE_RECOMPUTE_INTERVAL_MS);
    this.bubbleScoreTimer.unref?.();
  }

  private recomputeBubbleScores(
    marketIds?: Iterable<string>,
    computedAt = Date.now(),
  ): string[] {
    const ruleById = new Map(this.uiRules.map((rule) => [rule.id, rule]));
    const ids = marketIds
      ? Array.from(new Set(marketIds)).filter((marketId) => this.trackedMarketById.has(marketId))
      : Array.from(
          new Set([
            ...this.latestBubbleAlertByMarketId.keys(),
            ...this.bubbleSnapshotByMarketId.keys(),
          ]),
        );
    const changedMarketIds: string[] = [];

    for (const marketId of ids) {
      const alert = this.latestBubbleAlertByMarketId.get(marketId);
      const nextSnapshot = alert
        ? buildBubbleSnapshotFromAlert(alert, computedAt, ruleById)
        : undefined;
      const previousSnapshot = this.bubbleSnapshotByMarketId.get(marketId);

      if (nextSnapshot) {
        this.bubbleSnapshotByMarketId.set(marketId, nextSnapshot);
      } else {
        this.bubbleSnapshotByMarketId.delete(marketId);
      }

      if (!sameBubbleSnapshot(previousSnapshot, nextSnapshot)) {
        changedMarketIds.push(marketId);
      }
    }

    this.bubbleScoreUpdatedAt = new Date(computedAt).toISOString();
    return changedMarketIds;
  }

  private emitBubbleScoreTicks(marketIds?: Iterable<string>): void {
    const ids = marketIds
      ? Array.from(new Set(marketIds)).filter((marketId) => this.trackedMarketById.has(marketId))
      : Array.from(this.trackedMarketById.keys());

    for (const marketId of ids) {
      const row = this.buildMarketRow(marketId);
      if (row) {
        this.enqueueMarketTick(row);
      }
    }
  }

  private bindServiceEvents(): void {
    this.dataService.on('discovery', async (universe) => {
      await this.handleDiscovery(universe.events);
      this.hasSuccessfulDiscovery = true;
      this.clearServiceError();
      this.maybeRunStartupRuleCheck();
      this.queueDashboardTick();
      await this.emitHealth();
    });

    this.dataService.on('token_state', async (tokenState) => {
      await this.handleTokenState(tokenState);
    });

    this.dataService.on('ws_status', async (status) => {
      this.handleShardStatus(status);
      if (status.state === 'open') {
        this.clearServiceError();
      }
      this.maybeRunStartupRuleCheck();
      await this.emitHealth();
    });

    this.dataService.on('feed_stale', async (status) => {
      this.handleShardStatus(status);
      this.recordServiceError(
        'ws',
        `WebSocket 数据流延迟：${status.reason ?? '未知原因'}`,
      );
      const shardState = this.dataService
        .getState()
        .shardStates.find((item) => item.shardId === status.shardId);
      const triggers = this.alertEngine.evaluateFeedHealth(this.engineRules, {
        feedKey: status.shardId,
        status: 'degraded',
        lastMessageAt: shardState?.lastMessageAt ?? status.at,
        lastOkAt: shardState?.connectedAt ?? status.at,
        reconnectCount: status.reconnectAttempt,
        updatedAt: status.at,
      });
      this.persistAndEmitAlerts(triggers);
      this.maybeRunStartupRuleCheck();
      await this.emitHealth();
    });

    this.dataService.on('error', async (error) => {
      const rawMessage =
        error instanceof Error ? error.message : String(error ?? '未知错误');
      const source = classifyDataServiceErrorSource(rawMessage);
      this.recordServiceError(source, rawMessage);
      await this.emitHealth();
      console.error('[worker-runtime] data service error', error);
      this.emitEvent('alerts.new', {
        id: randomUUID(),
        ruleId: 'worker-error',
        triggeredAt: new Date().toISOString(),
        cityKey: '',
        marketId: '',
        tokenId: '',
        message: rawMessage,
        severity: 'warning',
        acknowledged: false,
        source: 'system',
      });
    });
  }

  private async handleDiscovery(events: NormalizedEvent[]): Promise<void> {
    const trackedEvents = events.map((event) => ({
      eventId: event.eventId,
      cityKey: event.cityKey ?? '',
      seriesSlug: event.seriesSlug,
      eventDate: event.eventDate,
      title: event.title ?? event.seriesSlug,
      active: event.active,
      closed: event.closed,
      endDate: null,
    }));
    const trackedMarkets = events.flatMap((event) =>
      event.markets
        .filter((market) => market.yesTokenId && market.noTokenId)
        .map((market) => {
          const tokenYesId = market.yesTokenId ?? '';
          const tokenNoId = market.noTokenId ?? '';
          return {
            marketId: market.marketId,
            eventId: event.eventId,
            cityKey: market.cityKey ?? event.cityKey ?? '',
            seriesSlug: event.seriesSlug,
            eventDate: event.eventDate,
            conditionId: market.conditionId ?? '',
            groupItemTitle: market.groupItemTitle ?? market.question ?? 'Unknown band',
            tokenYesId,
            tokenNoId,
            active: market.active,
            closed: market.closed,
            pinned: false,
          };
        }),
    );

    this.repository.upsertTrackedEvents(trackedEvents);
    this.repository.upsertTrackedMarkets(trackedMarkets);
    this.upsertTrackedMarketIndex(
      trackedMarkets.map((market) => ({
        ...market,
        updatedAt: Date.now(),
      })),
    );
    await this.applyDiscoveryPriceSeeds(events);
  }

  private async applyDiscoveryPriceSeeds(events: NormalizedEvent[]): Promise<void> {
    const timestamp = Date.now();
    const pendingStates: TokenRuntimeState[] = [];

    for (const event of events) {
      for (const market of event.markets) {
        if (market.yesTokenId && market.priceSeed?.yes) {
          const next = this.mergeDiscoveryPriceSeed(
            market.yesTokenId,
            market.priceSeed.yes,
            timestamp,
          );
          if (next) {
            pendingStates.push(next);
          }
        }

        if (market.noTokenId && market.priceSeed?.no) {
          const next = this.mergeDiscoveryPriceSeed(
            market.noTokenId,
            market.priceSeed.no,
            timestamp,
          );
          if (next) {
            pendingStates.push(next);
          }
        }
      }
    }

    for (const tokenState of pendingStates) {
      await this.handleTokenState(tokenState);
    }
  }

  private mergeDiscoveryPriceSeed(
    tokenId: string,
    seed: MarketPriceSeed,
    timestamp: number,
  ): TokenRuntimeState | null {
    const existing = this.latestTokenStateById.get(tokenId);
    const nextLastTradePrice =
      normalizeOptionalNumber(existing?.lastTradePrice) ?? seed.lastTradePrice;
    const nextBestBid = normalizeOptionalNumber(existing?.bestBid) ?? seed.bestBid;
    const nextBestAsk = normalizeOptionalNumber(existing?.bestAsk) ?? seed.bestAsk;
    const nextSpread =
      normalizeOptionalNumber(existing?.spread) ??
      normalizeOptionalNumber(resolveSpread(nextBestBid, nextBestAsk));

    if (
      sameOptionalNumber(existing?.lastTradePrice, nextLastTradePrice) &&
      sameOptionalNumber(existing?.bestBid, nextBestBid) &&
      sameOptionalNumber(existing?.bestAsk, nextBestAsk) &&
      sameOptionalNumber(existing?.spread, nextSpread)
    ) {
      return null;
    }

    return {
      tokenId,
      lastTradePrice: nextLastTradePrice,
      bestBid: nextBestBid,
      bestAsk: nextBestAsk,
      spread: nextSpread ?? undefined,
      updatedAt: timestamp,
      lastEventType: 'discovery',
    };
  }

  private refreshIndexes(): void {
    this.refreshCityIndex();
    this.refreshTrackedMarketIndex();
    this.refreshLatestTokenStateIndex();
    this.refreshUnackedAlertIndex();
    this.refreshBubbleAlertIndex();
  }

  private refreshCityIndex(): void {
    const next = new Map<string, DbCityConfig>();
    for (const city of this.repository.queryCityConfigs()) {
      next.set(city.cityKey, city);
    }
    this.cityByKey = next;
  }

  private upsertCityIndex(cities: DbCityConfig[]): void {
    for (const city of cities) {
      this.cityByKey.set(city.cityKey, city);
    }
  }

  private refreshTrackedMarketIndex(): void {
    const markets = this.repository.queryTrackedMarkets();
    this.trackedMarketById = new Map(markets.map((market) => [market.marketId, market]));
    const tokenMeta = new Map<string, TokenMeta>();
    for (const market of markets) {
      tokenMeta.set(market.tokenYesId, this.toTokenMeta(market, 'yes'));
      tokenMeta.set(market.tokenNoId, this.toTokenMeta(market, 'no'));
    }
    this.tokenMetaById = tokenMeta;
  }

  private upsertTrackedMarketIndex(markets: DbTrackedMarket[]): void {
    for (const market of markets) {
      const previous = this.trackedMarketById.get(market.marketId);
      if (previous) {
        if (previous.tokenYesId !== market.tokenYesId) {
          this.tokenMetaById.delete(previous.tokenYesId);
        }
        if (previous.tokenNoId !== market.tokenNoId) {
          this.tokenMetaById.delete(previous.tokenNoId);
        }
      }
      this.trackedMarketById.set(market.marketId, market);
      this.tokenMetaById.set(market.tokenYesId, this.toTokenMeta(market, 'yes'));
      this.tokenMetaById.set(market.tokenNoId, this.toTokenMeta(market, 'no'));
    }
  }

  private toTokenMeta(market: DbTrackedMarket, side: 'yes' | 'no'): TokenMeta {
    return {
      marketId: market.marketId,
      cityKey: market.cityKey,
      eventId: market.eventId,
      eventDate: market.eventDate,
      temperatureBand: market.groupItemTitle,
      seriesSlug: market.seriesSlug,
      side,
    };
  }

  private refreshLatestTokenStateIndex(): void {
    const states = this.repository.queryLatestTokenStates();
    this.latestTokenStateById = new Map(states.map((state) => [state.tokenId, state]));
  }

  private refreshUnackedAlertIndex(): void {
    this.unackedAlertById = new Map();
    this.unackedAlertCountByMarketId = new Map();
    this.unackedAlertCountByCityKey = new Map();
    this.latestUnackedAlertByMarketId = new Map();

    for (const row of this.queryAllAlertEventRows({ acknowledged: false })) {
      this.recordUnackedAlert({
        id: row.id,
        ruleId: row.ruleId,
        builtinKey: row.builtinKey,
        triggeredAt: row.triggeredAt,
        cityKey: row.cityKey,
        marketId: row.marketId,
        acknowledged: row.acknowledged,
      });
    }
  }

  private refreshBubbleAlertIndex(): void {
    this.latestBubbleAlertByMarketId = new Map();

    for (const row of this.repository.queryRecentAlertEventsForScoring(BUBBLE_ALERT_HISTORY_START_MS)) {
      this.recordBubbleAlert({
        id: row.id,
        ruleId: row.ruleId,
        builtinKey: row.builtinKey,
        triggeredAt: row.triggeredAt,
        marketId: row.marketId,
      });
    }
  }

  private recordBubbleAlert(row: BubbleAlertRow): boolean {
    if (!row.marketId) {
      return false;
    }

    const current = this.latestBubbleAlertByMarketId.get(row.marketId);
    if (current && !isNewerBubbleAlert(row, current)) {
      return false;
    }

    this.latestBubbleAlertByMarketId.set(row.marketId, row);
    return true;
  }

  private recordUnackedAlert(row: DashboardUnackedAlertRow): void {
    if (row.acknowledged || this.unackedAlertById.has(row.id)) {
      return;
    }

    this.unackedAlertById.set(row.id, row);
    incrementDashboardAlertCounter(this.unackedAlertCountByCityKey, row.cityKey);
    incrementDashboardAlertCounter(this.unackedAlertCountByMarketId, row.marketId);

    if (!row.marketId) {
      return;
    }

    const current = this.latestUnackedAlertByMarketId.get(row.marketId);
    if (!current || isNewerDashboardAlert(row, current)) {
      this.latestUnackedAlertByMarketId.set(row.marketId, row);
    }
  }

  private removeUnackedAlert(id: string): void {
    const row = this.unackedAlertById.get(id);
    if (!row) {
      return;
    }

    this.unackedAlertById.delete(id);
    decrementDashboardAlertCounter(this.unackedAlertCountByCityKey, row.cityKey);
    decrementDashboardAlertCounter(this.unackedAlertCountByMarketId, row.marketId);

    if (!row.marketId || this.latestUnackedAlertByMarketId.get(row.marketId)?.id !== id) {
      return;
    }

    let nextLatest: DashboardUnackedAlertRow | undefined;
    for (const candidate of this.unackedAlertById.values()) {
      if (candidate.marketId !== row.marketId) {
        continue;
      }
      if (!nextLatest || isNewerDashboardAlert(candidate, nextLatest)) {
        nextLatest = candidate;
      }
    }

    if (nextLatest) {
      this.latestUnackedAlertByMarketId.set(row.marketId, nextLatest);
      return;
    }

    this.latestUnackedAlertByMarketId.delete(row.marketId);
  }

  private upsertLatestTokenStateIndex(states: DbLatestTokenState[]): void {
    for (const state of states) {
      this.latestTokenStateById.set(state.tokenId, state);
    }
  }

  private async handleTokenState(tokenState: TokenRuntimeState): Promise<void> {
    const meta = this.tokenMetaById.get(tokenState.tokenId);
    if (!meta) {
      return;
    }

    const timestamp = tokenState.updatedAt;
    const updatedAt = Date.now();
    const latestState: DbLatestTokenState = {
      tokenId: tokenState.tokenId,
      marketId: meta.marketId,
      side: meta.side,
      lastTradePrice: tokenState.lastTradePrice ?? null,
      bestBid: tokenState.bestBid ?? null,
      bestAsk: tokenState.bestAsk ?? null,
      spread: tokenState.spread ?? null,
      lastMessageAt: timestamp,
      updatedAt,
    };
    this.repository.upsertLatestTokenStates([
      {
        tokenId: latestState.tokenId,
        marketId: latestState.marketId,
        side: latestState.side,
        lastTradePrice: latestState.lastTradePrice,
        bestBid: latestState.bestBid,
        bestAsk: latestState.bestAsk,
        spread: latestState.spread,
        lastMessageAt: latestState.lastMessageAt,
      },
    ]);
    this.upsertLatestTokenStateIndex([latestState]);
    this.queuePriceTick({
      tokenId: tokenState.tokenId,
      marketId: meta.marketId,
      timestamp,
      lastTradePrice: tokenState.lastTradePrice ?? null,
      bestBid: tokenState.bestBid ?? null,
      bestAsk: tokenState.bestAsk ?? null,
      spread: tokenState.spread ?? null,
    });

    const marketInput = {
      tokenId: tokenState.tokenId,
      marketId: meta.marketId,
      cityKey: meta.cityKey,
      seriesSlug: meta.seriesSlug,
      eventDate: meta.eventDate,
      temperatureBand: meta.temperatureBand,
      eventId: meta.eventId,
      side: meta.side,
      timestamp,
      lastTradePrice: tokenState.lastTradePrice,
      lastTradeSide: tokenState.lastTradeSide,
      lastTradeSize: tokenState.lastTradeSize,
      lastTradeAt: tokenState.lastTradeAt,
      bestBid: tokenState.bestBid,
      bestBidSize: tokenState.bestBidSize,
      bestAsk: tokenState.bestAsk,
      bestAskSize: tokenState.bestAskSize,
      bidLevelCount: tokenState.bidLevelCount,
      askLevelCount: tokenState.askLevelCount,
      bidVisibleSize: tokenState.bidVisibleSize,
      askVisibleSize: tokenState.askVisibleSize,
      removedBidEdge: tokenState.removedBidEdge,
      removedAskEdge: tokenState.removedAskEdge,
      spread: tokenState.spread,
      lastMessageAt: timestamp,
    };
    const alertSource = toTokenAlertSource(tokenState.lastEventType);
    if (alertSource === 'realtime') {
      if (!this.primedLiveAlertTokenIds.has(tokenState.tokenId)) {
        // Treat the first live tick after startup as the baseline for realtime alerting.
        this.primedLiveAlertTokenIds.add(tokenState.tokenId);
        this.marketState.recordTick(marketInput);
      } else {
        const triggers = this.alertEngine.evaluateMarketTick(this.engineRules, marketInput);
        this.persistAndEmitAlerts(triggers, {
          source: alertSource,
        });
      }
    } else {
      // Seed market history from discovery/backfill snapshots without treating them as fresh alerts.
      this.marketState.recordTick(marketInput);
    }
    this.maybeRunStartupRuleCheck(timestamp);

    const row = this.buildMarketRow(meta.marketId, undefined, timestamp);
    if (row) {
      this.enqueueMarketTick(row);
    }
  }

  private handleShardStatus(status: ShardStatusEvent): void {
    const shardState = this.dataService
      .getState()
      .shardStates.find((item) => item.shardId === status.shardId);
    const feedStatus = status.state === 'open' ? 'ok' : status.state === 'connecting' ? 'degraded' : 'down';
    this.feedState.upsert({
      feedKey: status.shardId,
      status: feedStatus,
      lastMessageAt: shardState?.lastMessageAt ?? status.at,
      lastOkAt: status.state === 'open' ? status.at : shardState?.connectedAt ?? undefined,
      reconnectCount: status.reconnectAttempt,
      updatedAt: status.at,
      latencyMs:
        shardState?.lastMessageAt && status.state === 'open'
          ? Math.max(0, Date.now() - shardState.lastMessageAt)
          : undefined,
    });
    this.repository.upsertFeedHealth([
      {
        feedKey: status.shardId,
        status: feedStatus,
        lastOkAt: status.state === 'open' ? status.at : shardState?.connectedAt ?? null,
        lastMessageAt: shardState?.lastMessageAt ?? status.at,
        lastError: status.reason ?? null,
        reconnectCount: status.reconnectAttempt,
        latencyMs:
          shardState?.lastMessageAt && status.state === 'open'
            ? Math.max(0, Date.now() - shardState.lastMessageAt)
            : null,
      },
    ]);
  }

  private persistAndEmitAlerts(
    triggers: AlertTrigger[],
    options?: {
      source?: EmittedAlertSource;
    },
  ): void {
    if (triggers.length === 0) {
      return;
    }
    const source = options?.source ?? 'realtime';
    const ruleById = new Map(this.uiRules.map((rule) => [rule.id, rule]));
    const enriched = triggers.map((trigger) => {
      const marketSnapshot = trigger.marketId
        ? this.buildAlertMarketSnapshot(trigger.marketId, trigger.tokenId)
        : trigger.marketSnapshot;
      const message = formatAlertMessage('zh-CN', {
        message: trigger.message,
        messageKey: trigger.messageKey,
        messageParams: trigger.messageParams,
        marketSnapshot,
      });
      return {
        ...trigger,
        marketSnapshot,
        message,
      };
    });
    this.repository.insertAlertEvents(enriched);
    const bubbleDirtyMarketIds: string[] = [];
    for (const trigger of enriched) {
      this.recordUnackedAlert({
        id: trigger.id,
        ruleId: trigger.ruleId,
        builtinKey: trigger.builtinKey ?? null,
        triggeredAt: trigger.triggeredAt,
        cityKey: trigger.cityKey ?? null,
        marketId: trigger.marketId ?? null,
        acknowledged: false,
      });
      if (
        this.recordBubbleAlert({
          id: trigger.id,
          ruleId: trigger.ruleId,
          builtinKey: trigger.builtinKey ?? null,
          triggeredAt: trigger.triggeredAt,
          marketId: trigger.marketId ?? null,
        }) &&
        trigger.marketId
      ) {
        bubbleDirtyMarketIds.push(trigger.marketId);
      }
    }
    this.recomputeBubbleScores(bubbleDirtyMarketIds);
    this.emitBubbleScoreTicks(
      enriched
        .map((trigger) => trigger.marketId)
        .filter((marketId): marketId is string => Boolean(marketId)),
    );
    for (const trigger of enriched) {
      this.emitEvent('alerts.new', {
        id: trigger.id,
        ruleId: trigger.ruleId,
        builtinKey: trigger.builtinKey,
        triggeredAt: new Date(trigger.triggeredAt).toISOString(),
        cityKey: trigger.cityKey ?? '',
        marketId: trigger.marketId ?? '',
        tokenId: trigger.tokenId ?? '',
        message: trigger.message,
        messageKey: trigger.messageKey,
        messageParams: trigger.messageParams,
        marketSnapshot: trigger.marketSnapshot,
        severity: severityToUi(trigger.severity),
        acknowledged: false,
        soundProfileId: ruleById.get(trigger.ruleId)?.soundProfileId ?? '',
        source,
      });
    }
    this.queueDashboardTick();
  }

  private maybeRunStartupRuleCheck(nowMs = Date.now()): void {
    if (this.startupRuleCheckCompleted || !this.serviceStarted || !this.hasSuccessfulDiscovery) {
      return;
    }

    const hasEnabledMarketRules = this.engineRules.some(
      (rule) => rule.enabled && rule.metric !== 'feed_stale',
    );
    const hasEnabledFeedRules = this.engineRules.some(
      (rule) => rule.enabled && rule.metric === 'feed_stale',
    );

    if (!hasEnabledMarketRules && !hasEnabledFeedRules) {
      this.startupRuleCheckCompleted = true;
      return;
    }

    if (hasEnabledMarketRules) {
      const hasFreshMarketState = Array.from(this.latestTokenStateById.values()).some(
        (state) => nowMs - state.lastMessageAt <= STARTUP_RULE_SCAN_MAX_STATE_AGE_MS,
      );
      if (!hasFreshMarketState) {
        return;
      }
    } else if (hasEnabledFeedRules && this.feedState.list().length === 0) {
      return;
    }

    this.startupRuleCheckCompleted = true;
    this.runCurrentRuleCheck(CURRENT_RULE_SCAN_ALERT_LIMIT, {
      nowMs,
      latestStateFilter: (state) => nowMs - state.lastMessageAt <= STARTUP_RULE_SCAN_MAX_STATE_AGE_MS,
      source: 'startup-scan',
    });
  }

  private runCurrentRuleCheck(
    maxAlerts = CURRENT_RULE_SCAN_ALERT_LIMIT,
    options?: {
      nowMs?: number;
      latestStateFilter?: (state: DbLatestTokenState) => boolean;
      source?: EmittedAlertSource;
    },
  ): void {
    if (maxAlerts <= 0 || this.engineRules.every((rule) => !rule.enabled)) {
      return;
    }

    const nowMs = options?.nowMs ?? Date.now();
    const triggers: AlertTrigger[] = [];
    const appendTriggers = (nextTriggers: AlertTrigger[]) => {
      const remaining = maxAlerts - triggers.length;
      if (remaining <= 0 || nextTriggers.length === 0) {
        return;
      }
      triggers.push(...nextTriggers.slice(0, remaining));
    };

    for (const feed of this.feedState.list()) {
      appendTriggers(this.alertEngine.evaluateFeedHealth(this.engineRules, feed, nowMs));
      if (triggers.length >= maxAlerts) {
        break;
      }
    }

    if (triggers.length < maxAlerts) {
      for (const state of this.latestTokenStateById.values()) {
        if (options?.latestStateFilter && !options.latestStateFilter(state)) {
          continue;
        }
        const meta = this.tokenMetaById.get(state.tokenId);
        if (!meta) {
          continue;
        }
        const latest = this.marketState.getLatest(state.tokenId);

        appendTriggers(
          this.alertEngine.evaluateMarketTick(
            this.engineRules,
            {
              tokenId: state.tokenId,
              marketId: meta.marketId,
              cityKey: meta.cityKey,
              seriesSlug: meta.seriesSlug,
              eventDate: meta.eventDate,
              temperatureBand: meta.temperatureBand,
              eventId: meta.eventId,
              side: meta.side,
              timestamp: nowMs,
              lastTradePrice: latest?.lastTradePrice ?? state.lastTradePrice ?? undefined,
              lastTradeSide: latest?.lastTradeSide,
              lastTradeSize: latest?.lastTradeSize,
              lastTradeAt: latest?.lastTradeAt,
              bestBid: latest?.bestBid ?? state.bestBid ?? undefined,
              bestBidSize: latest?.bestBidSize,
              bestAsk: latest?.bestAsk ?? state.bestAsk ?? undefined,
              bestAskSize: latest?.bestAskSize,
              bidLevelCount: latest?.bidLevelCount,
              askLevelCount: latest?.askLevelCount,
              bidVisibleSize: latest?.bidVisibleSize,
              askVisibleSize: latest?.askVisibleSize,
              removedBidEdge: latest?.removedBidEdge,
              removedAskEdge: latest?.removedAskEdge,
              spread: latest?.spread ?? state.spread ?? undefined,
              lastMessageAt: state.lastMessageAt,
            },
            nowMs,
          ),
        );

        if (triggers.length >= maxAlerts) {
          break;
        }
      }
    }

    this.persistAndEmitAlerts(triggers, {
      source: options?.source ?? 'realtime',
    });
  }

  private queryMarkets(query: MarketQuery | undefined): MarketQueryResult {
    const rows = this.buildMarketRows();
    const today = getTodayDateKey();
    let filtered = rows;

    if (query?.cityKey) {
      filtered = filtered.filter((row) => marketRowMatchesSearch(row, query.cityKey ?? ''));
    }
    if (query?.eventDate) {
      filtered = filtered.filter((row) => row.eventDate === query.eventDate);
    }
    if (query?.watchlistedOnly) {
      filtered = filtered.filter((row) => row.watchlisted);
    }
    if (query?.lotteryOnly) {
      filtered = filtered.filter((row) => row.lotteryCandidate === true);
    }
    if (query?.side && query.side !== 'BOTH') {
      filtered = filtered.filter(
        (row) => row.side === query.side || row.side === 'BOTH',
      );
    }

    if (!query?.eventDate) {
      const decisionUsefulRows = filtered.filter((row) => isDecisionUsefulMarketRow(row, today));
      filtered =
        decisionUsefulRows.length > 0
          ? decisionUsefulRows
          : filtered.filter((row) => row.status !== 'resolved' && row.eventDate >= today);
    }

    const sortBy = query?.sortBy ?? 'updatedAt';
    const sortDir = query?.sortDir ?? 'desc';
    filtered = filtered.sort((left, right) => {
      const lifecycleOrder = compareMarketLifecycle(left, right, today);
      if (lifecycleOrder !== 0) {
        return lifecycleOrder;
      }
      const direction = sortDir === 'asc' ? 1 : -1;
      const toComparable = (row: MarketRow): number =>
        sortBy === 'lotteryLift'
          ? row.lotteryLift ?? -1
          : sortBy === 'volume24h'
          ? row.volume24h
          : sortBy === 'change5m'
            ? row.change5m
            : sortBy === 'spread'
              ? row.spread ?? -1
              : Date.parse(row.updatedAt);
      const sortOrder = (toComparable(left) - toComparable(right)) * direction;
      if (sortOrder !== 0) {
        return sortOrder;
      }
      return left.marketId.localeCompare(right.marketId);
    });

    const limit = Math.max(1, Math.min(query?.limit ?? 2000, 2000));
    return {
      rows: filtered.slice(0, limit),
      total: filtered.length,
    };
  }

  private queryDashboard(query: DashboardQuery | undefined): DashboardSnapshot {
    const rows = this.buildMarketRows();
    const today = getTodayDateKey();
    const availableDates = Array.from(new Set(rows.map((row) => row.eventDate))).sort((left, right) =>
      right.localeCompare(left),
    );
    const decisionUsefulDates = Array.from(
      new Set(
        rows
          .filter((row) => isDecisionUsefulMarketRow(row, today))
          .map((row) => row.eventDate),
      ),
    ).sort((left, right) => left.localeCompare(right));
    const fallbackFutureDates = Array.from(
      new Set(
        rows
          .filter((row) => row.status !== 'resolved' && row.eventDate >= today)
          .map((row) => row.eventDate),
      ),
    ).sort((left, right) => left.localeCompare(right));
    const requestedDate = query?.eventDate?.trim() ?? '';
    const selectedDate = availableDates.includes(requestedDate)
      ? requestedDate
      : (decisionUsefulDates[0] ?? fallbackFutureDates[0] ?? requestedDate);
    const scope = query?.scope ?? 'risk';
    const rowsForDate = selectedDate
      ? rows.filter((row) => row.eventDate === selectedDate)
      : [];
    const ruleById = new Map(this.uiRules.map((rule) => [rule.id, rule]));

    const rowsByCityKey = new Map<string, MarketRow[]>();
    for (const row of rowsForDate) {
      const items = rowsByCityKey.get(row.cityKey) ?? [];
      items.push(row);
      rowsByCityKey.set(row.cityKey, items);
    }

    const summaries: DashboardSnapshot['rows'] = [];
    for (const [cityKey, cityRows] of rowsByCityKey.entries()) {
      const rankedMarkets = [...cityRows].sort((left, right) =>
        compareDashboardMarketRows(
          left,
          right,
          this.unackedAlertCountByMarketId.get(left.marketId) ?? 0,
          this.unackedAlertCountByMarketId.get(right.marketId) ?? 0,
        ),
      );
      const dominantMarket = rankedMarkets[0];
      if (!dominantMarket) {
        continue;
      }

      const topScores = rankedMarkets
        .map((row) => row.bubbleScore)
        .sort((left, right) => right - left);
      const cityBubbleScore = Math.min(
        BUBBLE_SCORE_MAX,
        (topScores[0] ?? 0) + (topScores[1] ?? 0) * 0.2 + (topScores[2] ?? 0) * 0.1,
      );
      const cityBubbleSeverity = rankedMarkets.reduce<MarketRow['bubbleSeverity']>(
        (current, row) =>
          BUBBLE_SEVERITY_RANK[row.bubbleSeverity] > BUBBLE_SEVERITY_RANK[current]
            ? row.bubbleSeverity
            : current,
        'none',
      );
      const dominantAlert = this.latestUnackedAlertByMarketId.get(dominantMarket.marketId);
      const updatedAtMs = Math.max(...cityRows.map((row) => parseIsoTime(row.updatedAt)));

      summaries.push({
        cityKey,
        cityName: dominantMarket.cityName,
        airportCode: dominantMarket.airportCode || null,
        eventDate: selectedDate,
        marketCount: cityRows.length,
        watchlisted: cityRows.some((row) => row.watchlisted),
        unackedAlertCount: this.unackedAlertCountByCityKey.get(cityKey) ?? 0,
        cityBubbleScore: Number(cityBubbleScore.toFixed(2)),
        cityBubbleSeverity,
        dominantMarketId: dominantMarket.marketId,
        dominantTemperatureBand: dominantMarket.temperatureBand,
        dominantYesPrice: dominantMarket.yesPrice,
        dominantRuleName: dominantAlert
          ? resolveDashboardRuleName(dominantAlert.ruleId, dominantAlert.builtinKey, ruleById)
          : null,
        updatedAt: new Date(updatedAtMs || Date.now()).toISOString(),
        topMarkets: rankedMarkets.slice(0, 5).map((row) => ({
          marketId: row.marketId,
          temperatureBand: row.temperatureBand,
          yesPrice: row.yesPrice,
          bestBid: row.bestBid,
          bestAsk: row.bestAsk,
          spread: row.spread,
          change5m: row.change5m,
          bubbleScore: row.bubbleScore,
          bubbleSeverity: row.bubbleSeverity,
          updatedAt: row.updatedAt,
        })),
      });
    }

    const scopedRows = summaries
      .filter((row) => {
        if (scope === 'watchlist') {
          return row.watchlisted;
        }
        if (scope === 'alerts') {
          return row.unackedAlertCount > 0;
        }
        return true;
      })
      .sort(compareCityBubbleSummaries);
    const visibleRows = scopedRows.slice(0, DASHBOARD_MAX_VISIBLE_CITIES);
    const coveredMarketCount = visibleRows.reduce((sum, row) => sum + row.marketCount, 0);
    const updatedAtMs =
      Math.max(...rowsForDate.map((row) => parseIsoTime(row.updatedAt)), 0) || Date.now();

    return {
      rows: visibleRows,
      coveredMarketCount,
      visibleCityCount: visibleRows.length,
      totalCityCount: scopedRows.length,
      hiddenCityCount: Math.max(0, scopedRows.length - visibleRows.length),
      selectedDate,
      scope,
      availableDates,
      updatedAt: new Date(updatedAtMs).toISOString(),
    };
  }

  private listAlerts(
    query: WorkerInvokePayloadMap['alerts.list'],
  ): AlertListResult {
    const result = this.repository.queryAlertEvents({
      limit: query?.limit ?? ALERT_EVENT_PAGE_LIMIT_DEFAULT,
      acknowledged: query?.acknowledged,
      cursor: parseAlertListCursor(query?.cursor),
    });
    const ruleById = new Map(this.uiRules.map((rule) => [rule.id, rule]));
    return {
      rows: result.rows.map((row) => ({
        id: row.id,
        ruleId: row.ruleId,
        builtinKey: (row.builtinKey as BuiltinRuleKey | null | undefined) ?? undefined,
        triggeredAt: new Date(row.triggeredAt).toISOString(),
        cityKey: row.cityKey ?? '',
        marketId: row.marketId ?? '',
        tokenId: row.tokenId ?? '',
        message: formatAlertMessage('zh-CN', {
          message: row.message,
          messageKey: row.messageKey as AlertEvent['messageKey'],
          messageParams: row.messageParams
            ? (JSON.parse(row.messageParams) as AlertEvent['messageParams'])
            : undefined,
          marketSnapshot: row.marketSnapshot
            ? (JSON.parse(row.marketSnapshot) as AlertEvent['marketSnapshot'])
            : undefined,
        }),
        messageKey: (row.messageKey as AlertEvent['messageKey']) ?? undefined,
        messageParams: row.messageParams
          ? (JSON.parse(row.messageParams) as AlertEvent['messageParams'])
          : undefined,
        marketSnapshot: row.marketSnapshot
          ? (JSON.parse(row.marketSnapshot) as AlertEvent['marketSnapshot'])
          : undefined,
        severity: severityToUi(row.severity as AlertSeverity),
        acknowledged: row.acknowledged,
        soundProfileId: ruleById.get(row.ruleId)?.soundProfileId ?? '',
      })),
      total: result.total,
      hasMore: result.hasMore,
      nextCursor: toAlertListCursor(result.nextCursor),
    };
  }

  private queryAllAlertEventRows(
    query: Omit<AlertEventQuery, 'cursor' | 'limit'> = {},
  ): DbAlertEventRow[] {
    const rows: DbAlertEventRow[] = [];
    let cursor: AlertEventQuery['cursor'];
    let previousCursorKey: string | undefined;

    for (;;) {
      const page = this.repository.queryAlertEvents({
        ...query,
        limit: ALERT_EVENT_PAGE_LIMIT_MAX,
        cursor,
      });
      rows.push(...page.rows);

      if (!page.hasMore || !page.nextCursor) {
        return rows;
      }

      const nextCursorKey = `${page.nextCursor.triggeredAt}:${page.nextCursor.id}`;
      if (nextCursorKey === previousCursorKey) {
        return rows;
      }

      previousCursorKey = nextCursorKey;
      cursor = page.nextCursor;
    }
  }

  private ackAlerts(payload: WorkerInvokePayloadMap['alerts.ack']): { ok: true; updated: number } {
    const ids = payload.ids ?? (payload.id ? [payload.id] : []);
    let updated = 0;
    for (const id of ids) {
      this.repository.acknowledgeAlertEvent(id);
      this.removeUnackedAlert(id);
      updated += 1;
    }
    if (updated > 0) {
      this.queueDashboardTick();
    }
    return { ok: true, updated };
  }

  private previewRule(rule: RulePreviewPayload): RulePreviewResult {
    const rows = this.buildMarketRows().filter((row) => {
      if (rule.scope?.cityKey && row.cityKey !== rule.scope.cityKey) {
        return false;
      }
      const trackedMarket = this.trackedMarketById.get(row.marketId);
      if (rule.scope?.seriesSlug && trackedMarket?.seriesSlug !== rule.scope.seriesSlug) {
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
      if (
        rule.scope?.tokenId &&
        trackedMarket &&
        trackedMarket.tokenYesId !== rule.scope.tokenId &&
        trackedMarket.tokenNoId !== rule.scope.tokenId
      ) {
        return false;
      }
      return true;
    });

    const ordered = [...rows].sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );

    return {
      matchedCityCount: new Set(rows.map((row) => row.cityKey)).size,
      matchedMarketCount: rows.length,
      sampleMarkets: ordered.slice(0, 3).map((row) => ({
        marketId: row.marketId,
        cityKey: row.cityKey,
        cityName: row.cityName,
        eventDate: row.eventDate,
        temperatureBand: row.temperatureBand,
        side: row.side,
        yesPrice: row.yesPrice,
        bestBid: row.bestBid,
        bestAsk: row.bestAsk,
        spread: row.spread,
        updatedAt: row.updatedAt,
      })),
    };
  }

  private saveRules(payload: RuleSavePayload): { rows: AlertRule[] } {
    const nextRules = normalizeRuleSavePayload(payload).map((rule) => ({
      ...rule,
      operator: rule.metric === 'liquidity_kill' || rule.metric === 'volume_pricing' ? '>=' : rule.operator,
      dedupeWindowSec:
        typeof rule.dedupeWindowSec === 'number' && Number.isFinite(rule.dedupeWindowSec)
          ? Math.max(0, Math.trunc(rule.dedupeWindowSec))
          : Math.max(30, Math.floor(rule.cooldownSec / 2)),
      bubbleWeight: resolveBubbleWeight(rule, rule.builtinKey),
      soundProfileId: rule.soundProfileId ?? '',
      liquiditySide:
        rule.metric === 'liquidity_kill'
          ? normalizeLiquiditySide(rule.liquiditySide) ?? 'both'
          : normalizeLiquiditySide(rule.liquiditySide),
      isBuiltin: rule.isBuiltin ?? Boolean(rule.builtinKey),
      scope: {
        cityKey: rule.scope?.cityKey ?? '',
        seriesSlug: rule.scope?.seriesSlug ?? '',
        eventDate: rule.scope?.eventDate ?? '',
        temperatureBand: rule.scope?.temperatureBand ?? '',
        marketId: rule.scope?.marketId ?? '',
        tokenId: rule.scope?.tokenId ?? '',
        side: rule.scope?.side ?? 'BOTH',
      },
      quietHours:
        rule.quietHours &&
        Number.isFinite(rule.quietHours.startMinute) &&
        Number.isFinite(rule.quietHours.endMinute)
          ? {
              startMinute: Math.max(0, Math.min(1439, Math.trunc(rule.quietHours.startMinute))),
              endMinute: Math.max(0, Math.min(1439, Math.trunc(rule.quietHours.endMinute))),
            }
          : undefined,
    }));
    this.applyUiRules(nextRules);
    this.repository.upsertAlertRules(this.engineRules);
    this.runCurrentRuleCheck(CURRENT_RULE_SCAN_ALERT_LIMIT, {
      source: 'rules-save-scan',
    });
    const changedBubbleMarketIds = this.recomputeBubbleScores();
    if (changedBubbleMarketIds.length > 0) {
      this.emitBubbleScoreTicks(changedBubbleMarketIds);
    }
    this.queueDashboardTick();
    return { rows: [...this.uiRules] };
  }

  private getSettingsPayload(): SettingsPayload {
    const settings = this.readSettings();
    const soundProfiles = this.repository.querySoundProfiles().map<SoundProfile>((profile) => ({
      id: profile.id,
      name: profile.name,
      filePath: profile.filePath,
      gain: profile.volume,
      enabled: profile.enabled,
      isBuiltin: profile.isBuiltin,
      isDefault: profile.id === settings.selectedSoundProfileId,
    }));
    return {
      settings,
      soundProfiles,
      storageMaintenance: { ...this.maintenanceSummary },
    };
  }

  private updateSettings(patch: Partial<AppSettings>): SettingsPayload {
    const previousSettings = this.readSettings();
    const nextSettings = {
      ...previousSettings,
      ...patch,
      tickRetentionDays: normalizeTickRetentionDays(
        patch.tickRetentionDays ?? previousSettings.tickRetentionDays,
      ),
      alertRetentionDays: normalizeAlertRetentionDays(
        patch.alertRetentionDays ?? previousSettings.alertRetentionDays,
      ),
    };
    this.writeSettings(nextSettings);
    const retentionChanged =
      nextSettings.tickRetentionDays !== previousSettings.tickRetentionDays ||
      nextSettings.alertRetentionDays !== previousSettings.alertRetentionDays;
    this.refreshRulesSync();
    if (retentionChanged) {
      void this.runStorageMaintenance('settings-update', {
        allowCompaction: true,
      }).catch(() => undefined);
    }
    return this.getSettingsPayload();
  }

  private async importCityMap(
    payload: WorkerInvokePayloadMap['settings.importCityMap'],
  ): Promise<{ ok: true; imported: number }> {
    let imported = 0;
    if (!payload) {
      return { ok: true, imported };
    }

    if (payload.filePath) {
      const fileRaw = await fs.readFile(payload.filePath, 'utf8');
      const parsed = JSON.parse(fileRaw);
      const cities = cityConfigArraySchema.parse(parsed);
      const citiesForDb = cities.map(toDbCityConfig);
      this.repository.upsertCityConfigs(citiesForDb);
      this.upsertCityIndex(
        citiesForDb.map((city) => ({
          ...city,
          updatedAt: Date.now(),
        })),
      );
      imported = cities.length;
    } else if (payload.lines) {
      const existing = new Map<string, DbCityConfig>(
        Array.from(this.cityByKey.values(), (city) => [city.cityKey, city]),
      );
      const nextCities: DbCityConfig[] = [];
      for (const line of payload.lines) {
        const [cityKeyRaw, airportCodeRaw, timezoneRaw] = line.split(',').map((item) => item.trim());
        if (!cityKeyRaw) {
          continue;
        }
        const current = existing.get(cityKeyRaw);
        if (!current) {
          continue;
        }
        nextCities.push({
          ...current,
          airportCode: airportCodeRaw || current.airportCode,
          timezone: timezoneRaw || current.timezone,
        });
      }
      if (nextCities.length > 0) {
        this.repository.upsertCityConfigs(nextCities.map((city) => ({
          cityKey: city.cityKey,
          displayName: city.displayName,
          seriesSlug: city.seriesSlug,
          airportCode: city.airportCode,
          timezone: city.timezone,
          enabled: city.enabled,
          resolutionSourceOverride: city.resolutionSourceOverride,
        })));
        this.upsertCityIndex(
          nextCities.map((city) => ({
            ...city,
            updatedAt: Date.now(),
          })),
        );
        imported = nextCities.length;
      }
    }

    if (imported > 0) {
      await this.dataService.refreshDiscovery();
    }

    return { ok: true, imported };
  }

  private registerSound(
    payload: RegisterSoundPayload | undefined,
  ): SettingsPayload {
    if (!payload) {
      return this.getSettingsPayload();
    }
    const existingProfile = payload.id
      ? this.repository.querySoundProfiles().find((profile) => profile.id === payload.id)
      : undefined;
    const soundId = payload.id || randomUUID();
    const filePath = payload.filePath ?? existingProfile?.filePath;
    if (!filePath) {
      return this.getSettingsPayload();
    }
    const nextGain = clampSoundGain(payload.gain, existingProfile?.volume ?? 1);
    this.repository.upsertSoundProfiles([
      {
        id: soundId,
        name: payload.name?.trim() || existingProfile?.name || path.basename(filePath),
        filePath,
        volume: nextGain,
        enabled: payload.enabled ?? existingProfile?.enabled ?? true,
        isBuiltin: payload.isBuiltin ?? existingProfile?.isBuiltin ?? false,
        isDefault: payload.setAsDefault ?? existingProfile?.isDefault ?? false,
      },
    ]);
    const currentSettings = this.readSettings();
    const shouldUseAsDefault =
      payload.setAsDefault === true ||
      (!currentSettings.selectedSoundProfileId && (payload.enabled ?? existingProfile?.enabled ?? true));

    if (shouldUseAsDefault) {
      this.writeSettings({
        ...currentSettings,
        selectedSoundProfileId: soundId,
      });
    } else if (
      currentSettings.selectedSoundProfileId === soundId &&
      payload.enabled === false
    ) {
      this.writeSettings({
        ...currentSettings,
        selectedSoundProfileId: BUILTIN_DEFAULT_SOUND_ID,
      });
    }
    return this.getSettingsPayload();
  }

  private pickSound(
    payload: WorkerInvokePayloadMap['settings.pickSound'],
  ): SettingsPayload {
    const soundId = payload?.id?.trim();
    if (!soundId) {
      return this.getSettingsPayload();
    }

    const existingProfile = this.repository.querySoundProfiles().find((profile) => profile.id === soundId);
    if (!existingProfile) {
      return this.getSettingsPayload();
    }

    if (!existingProfile.enabled) {
      this.repository.upsertSoundProfiles([
        {
          ...existingProfile,
          enabled: true,
        },
      ]);
    }

    const currentSettings = this.readSettings();
    if (currentSettings.selectedSoundProfileId !== soundId) {
      this.writeSettings({
        ...currentSettings,
        selectedSoundProfileId: soundId,
      });
    }

    return this.getSettingsPayload();
  }

  private readSettings(): AppSettings {
    const read = (key: keyof typeof APP_SETTING_KEYS, fallback: string) =>
      this.repository.queryAppSetting(APP_SETTING_KEYS[key])?.value ?? fallback;

    return {
      startOnBoot: read('startOnBoot', String(DEFAULT_SETTINGS.startOnBoot)) === 'true',
      backgroundAudio:
        read('backgroundAudio', String(DEFAULT_SETTINGS.backgroundAudio)) === 'true',
      reconnectPolicy:
        (read('reconnectPolicy', DEFAULT_SETTINGS.reconnectPolicy) as AppSettings['reconnectPolicy']) ??
        DEFAULT_SETTINGS.reconnectPolicy,
      pollIntervalSec: Number(read('pollIntervalSec', String(DEFAULT_SETTINGS.pollIntervalSec))),
      tickRetentionDays: normalizeTickRetentionDays(
        read('tickRetentionDays', String(DEFAULT_SETTINGS.tickRetentionDays)),
      ),
      alertRetentionDays: normalizeAlertRetentionDays(
        read('alertRetentionDays', String(DEFAULT_SETTINGS.alertRetentionDays)),
      ),
      selectedSoundProfileId: read(
        'selectedSoundProfileId',
        DEFAULT_SETTINGS.selectedSoundProfileId,
      ),
      quietHoursStart: read('quietHoursStart', DEFAULT_SETTINGS.quietHoursStart),
      quietHoursEnd: read('quietHoursEnd', DEFAULT_SETTINGS.quietHoursEnd),
    };
  }

  private writeSettings(settings: AppSettings): void {
    this.repository.upsertAppSetting({
      key: APP_SETTING_KEYS.startOnBoot,
      value: String(settings.startOnBoot),
      updatedAt: Date.now(),
    });
    this.repository.upsertAppSetting({
      key: APP_SETTING_KEYS.backgroundAudio,
      value: String(settings.backgroundAudio),
      updatedAt: Date.now(),
    });
    this.repository.upsertAppSetting({
      key: APP_SETTING_KEYS.reconnectPolicy,
      value: settings.reconnectPolicy,
      updatedAt: Date.now(),
    });
    this.repository.upsertAppSetting({
      key: APP_SETTING_KEYS.pollIntervalSec,
      value: String(settings.pollIntervalSec),
      updatedAt: Date.now(),
    });
    this.repository.upsertAppSetting({
      key: APP_SETTING_KEYS.tickRetentionDays,
      value: String(normalizeTickRetentionDays(settings.tickRetentionDays)),
      updatedAt: Date.now(),
    });
    this.repository.upsertAppSetting({
      key: APP_SETTING_KEYS.alertRetentionDays,
      value: String(normalizeAlertRetentionDays(settings.alertRetentionDays)),
      updatedAt: Date.now(),
    });
    this.repository.upsertAppSetting({
      key: APP_SETTING_KEYS.selectedSoundProfileId,
      value: settings.selectedSoundProfileId,
      updatedAt: Date.now(),
    });
    this.repository.upsertAppSetting({
      key: APP_SETTING_KEYS.quietHoursStart,
      value: settings.quietHoursStart,
      updatedAt: Date.now(),
    });
    this.repository.upsertAppSetting({
      key: APP_SETTING_KEYS.quietHoursEnd,
      value: settings.quietHoursEnd,
      updatedAt: Date.now(),
    });
  }

  private buildMarketRows(): MarketRow[] {
    return Array.from(this.trackedMarketById.values())
      .map((market) => this.buildMarketRow(market.marketId, market))
      .filter((row): row is MarketRow => Boolean(row));
  }

  private computeLotterySignal(
    tokenId: string,
    asOfTimestamp = Date.now(),
  ): LotterySignalSnapshot | null {
    const latest = this.marketState.getLatest(tokenId);
    if (!latest) {
      return null;
    }

    const currentAsk = normalizeOptionalNumber(latest.bestAsk);
    if (
      currentAsk === undefined ||
      currentAsk <= 0 ||
      currentAsk > LOTTERY_SIGNAL_CURRENT_ASK_MAX
    ) {
      return null;
    }

    if (
      latest.lastMessageAt !== undefined &&
      asOfTimestamp - latest.lastMessageAt > LOTTERY_SIGNAL_FRESH_MS
    ) {
      return null;
    }

    const spread = normalizeOptionalNumber(latest.spread);
    if (spread !== undefined && spread > LOTTERY_SIGNAL_MAX_SPREAD) {
      return null;
    }

    const referenceAsk = this.resolveLotteryReferenceAsk(tokenId, latest, currentAsk, asOfTimestamp);
    if (referenceAsk === undefined) {
      return null;
    }

    const lift = Number((currentAsk - referenceAsk).toFixed(6));
    if (lift < resolveLotteryMinLift(referenceAsk)) {
      return null;
    }

    const confirmation = resolveLotteryConfirmation(latest, referenceAsk, currentAsk, asOfTimestamp);
    if (!confirmation) {
      return null;
    }

    return {
      referenceAsk,
      currentAsk,
      lift,
      confirmationSource: confirmation.source,
      effectiveSize: confirmation.effectiveSize,
      effectiveNotional: confirmation.effectiveNotional,
      updatedAt: new Date(latest.timestamp).toISOString(),
    };
  }

  private resolveLotteryReferenceAsk(
    tokenId: string,
    latest: MarketTickSnapshot,
    currentAsk: number,
    asOfTimestamp: number,
  ): number | undefined {
    const edgeReference = normalizeOptionalNumber(latest.removedAskEdge?.previousPrice);
    if (
      edgeReference !== undefined &&
      edgeReference <= LOTTERY_SIGNAL_REFERENCE_ASK_MAX &&
      currentAsk - edgeReference >= resolveLotteryMinLift(edgeReference)
    ) {
      return edgeReference;
    }

    const history = this.marketState
      .getHistory(tokenId, LOTTERY_SIGNAL_WINDOW_MS, asOfTimestamp)
      .filter((entry) => entry.timestamp < asOfTimestamp);

    for (let index = history.length - 1; index >= 0; index -= 1) {
      const candidateAsk = normalizeOptionalNumber(history[index]?.bestAsk);
      if (
        candidateAsk !== undefined &&
        candidateAsk <= LOTTERY_SIGNAL_REFERENCE_ASK_MAX &&
        currentAsk - candidateAsk >= resolveLotteryMinLift(candidateAsk)
      ) {
        return candidateAsk;
      }
    }

    return undefined;
  }

  private buildMarketRow(
    marketId: string,
    marketSnapshot?: DbTrackedMarket,
    asOfTimestamp?: number,
  ): MarketRow | null {
    const market = marketSnapshot ?? this.trackedMarketById.get(marketId);
    if (!market) {
      return null;
    }

    const city = this.cityByKey.get(market.cityKey);
    const yesState = this.latestTokenStateById.get(market.tokenYesId);
    const noState = this.latestTokenStateById.get(market.tokenNoId);

    const yesLatest = this.marketState.getLatest(market.tokenYesId);
    const noLatest = this.marketState.getLatest(market.tokenNoId);
    const bestBid = yesLatest?.bestBid ?? yesState?.bestBid ?? null;
    const bestAsk = yesLatest?.bestAsk ?? yesState?.bestAsk ?? null;
    const yesPrice = resolveDisplayPrice(
      yesLatest?.lastTradePrice ?? yesState?.lastTradePrice ?? null,
      bestBid,
      bestAsk,
    );
    const noPrice =
      resolveDisplayPrice(
        noLatest?.lastTradePrice ?? noState?.lastTradePrice ?? null,
        noLatest?.bestBid ?? noState?.bestBid ?? null,
        noLatest?.bestAsk ?? noState?.bestAsk ?? null,
      ) ?? complementPrice(yesPrice);
    const spread =
      yesLatest?.spread ??
      yesState?.spread ??
      resolveSpread(bestBid, bestAsk);
    const change5m = this.computePriceChangePct(
      market.tokenYesId,
      yesPrice ?? 0,
      asOfTimestamp,
    );
    const bubbleSnapshot = this.bubbleSnapshotByMarketId.get(market.marketId);
    const lotterySignal = this.computeLotterySignal(market.tokenYesId, asOfTimestamp);

    const updatedAt = new Date(
      Math.max(
        market.updatedAt,
        yesLatest?.timestamp ?? 0,
        yesState?.updatedAt ?? 0,
        noLatest?.timestamp ?? 0,
        noState?.updatedAt ?? 0,
      ),
    ).toISOString();

    return {
      marketId: market.marketId,
      cityKey: market.cityKey,
      cityName: city?.displayName ?? market.cityKey,
      airportCode: city?.airportCode ?? '',
      eventDate: market.eventDate,
      temperatureBand: market.groupItemTitle,
      side: 'BOTH',
      yesPrice,
      noPrice,
      bestBid,
      bestAsk,
      spread,
      change5m,
      volume24h: 0,
      status: market.closed ? 'resolved' : market.active ? 'active' : 'halted',
      bubbleScore: bubbleSnapshot?.score ?? 0,
      bubbleSeverity: bubbleSnapshot?.severity ?? 'none',
      bubbleUpdatedAt: this.bubbleScoreUpdatedAt,
      updatedAt,
      watchlisted: market.pinned,
      lotteryCandidate: Boolean(lotterySignal),
      lotteryReferenceAsk: lotterySignal?.referenceAsk ?? null,
      lotteryCurrentAsk: lotterySignal?.currentAsk ?? null,
      lotteryLift: lotterySignal?.lift ?? null,
      lotteryConfirmationSource: lotterySignal?.confirmationSource ?? null,
      lotteryEffectiveSize: lotterySignal?.effectiveSize ?? null,
      lotteryEffectiveNotional: lotterySignal?.effectiveNotional ?? null,
      lotteryUpdatedAt: lotterySignal?.updatedAt ?? null,
    };
  }

  private buildAlertMarketSnapshot(marketId: string, tokenId?: string): AlertMarketSnapshot | undefined {
    const row = this.buildMarketRow(marketId);
    if (!row) {
      return undefined;
    }
    const tokenLatest = tokenId ? this.marketState.getLatest(tokenId) : undefined;
    return {
      cityName: row.cityName,
      airportCode: row.airportCode,
      eventDate: row.eventDate,
      temperatureBand: row.temperatureBand,
      yesPrice: row.yesPrice,
      lastTradePrice: tokenLatest?.lastTradePrice ?? null,
      lastTradeSize: tokenLatest?.lastTradeSize ?? null,
      bestBid: tokenLatest?.bestBid ?? row.bestBid,
      bestBidSize: tokenLatest?.bestBidSize ?? null,
      bestAsk: tokenLatest?.bestAsk ?? row.bestAsk,
      bestAskSize: tokenLatest?.bestAskSize ?? null,
      bidVisibleSize: tokenLatest?.bidVisibleSize ?? null,
      askVisibleSize: tokenLatest?.askVisibleSize ?? null,
      spread: tokenLatest?.spread ?? row.spread,
      change5m: row.change5m,
    };
  }

  private computePriceChangePct(
    tokenId: string,
    currentValue: number,
    timestamp?: number,
  ): number {
    if (!Number.isFinite(currentValue)) {
      return 0;
    }

    if (timestamp === undefined) {
      const entries = this.priceWindowByToken.get(tokenId);
      const base = entries?.[0]?.price;
      if (base === undefined || !Number.isFinite(base) || Math.abs(base) < Number.EPSILON) {
        return 0;
      }
      return ((currentValue - base) / base) * 100;
    }

    const window = this.priceWindowByToken.get(tokenId) ?? [];
    const cutoff = timestamp - PRICE_CHANGE_WINDOW_MS;
    window.push({ timestamp, price: currentValue });
    while (
      window.length > 0 &&
      (window.length > PRICE_CHANGE_WINDOW_MAX_ENTRIES ||
        (window[0]?.timestamp ?? 0) < cutoff)
    ) {
      window.shift();
    }
    this.priceWindowByToken.set(tokenId, window);
    const base = window[0]?.price;
    if (!Number.isFinite(base) || Math.abs(base) < Number.EPSILON) {
      return 0;
    }
    return ((currentValue - base) / base) * 100;
  }

  private async emitHealth(): Promise<void> {
    const state = this.dataService.getState();
    const shards = state.shardStates;
    const shardActive = shards.filter((item) => item.state === 'open').length;
    const reconnects = shards.reduce((sum, item) => sum + item.reconnectAttempt, 0);
    const latestMessageAt = Math.max(
      0,
      ...shards.map((item) => item.lastMessageAt ?? 0),
      ...(state.universe ? [Date.parse(state.universe.discoveredAt)] : [0]),
    );
    const latencyMs =
      latestMessageAt > 0 ? Math.max(0, Date.now() - latestMessageAt) : 0;
    const anyConnecting = shards.some((item) => item.state === 'connecting');
    const anyClosed = shards.some((item) => item.state === 'closed');
    const discoveryState: NonNullable<AppHealth['serviceStatus']>['discovery'] =
      this.lastServiceErrorSource === 'discovery' || this.lastServiceErrorSource === 'startup'
        ? 'error'
        : !state.universe
          ? 'discovering'
          : state.universe.tokenCount === 0
            ? 'empty'
            : 'ready';
    const websocketState: NonNullable<AppHealth['serviceStatus']>['websocket'] =
      shards.length === 0
        ? discoveryState === 'ready'
          ? 'connecting'
          : 'disconnected'
        : shardActive === 0
          ? anyConnecting
            ? 'connecting'
            : 'disconnected'
          : shardActive < shards.length
            ? 'partial'
            : 'connected';
    const dataFreshness: NonNullable<AppHealth['serviceStatus']>['dataFreshness'] =
      latestMessageAt <= 0
        ? 'unknown'
        : latencyMs <= 4_000
          ? 'realtime'
          : latencyMs <= 15_000
            ? 'delayed'
            : 'stale';
    const startupPhase: AppHealth['startupPhase'] =
      !this.serviceStarted
        ? 'degraded'
        : shardActive > 0
          ? 'running'
          : anyConnecting || !this.hasSuccessfulDiscovery
            ? 'starting'
            : 'degraded';
    const diagnostic =
      this.lastServiceError ??
      (!state.universe
        ? '正在发现市场...'
        : state.universe.tokenCount === 0
          ? '未发现可订阅的市场 Token。'
          : shards.length === 0
            ? '正在准备 WebSocket 分片...'
            : shardActive === 0 && anyConnecting
              ? '正在连接实时 WebSocket...'
              : shardActive === 0 && anyClosed
                ? '分片暂不可用，正在重试...'
                : null);
    const subscribedTokens =
      this.serviceStarted && state.universe ? state.universe.tokenCount : 0;
    const normalizedDiagnostic = normalizeWorkerDiagnostic(diagnostic);

    this.health = {
      connected: shardActive > 0,
      mode:
        shardActive === 0
          ? 'degraded'
          : shards.some((item) => item.state !== 'open')
            ? 'degraded'
            : 'live',
      shardActive,
      shardTotal: shards.length,
      subscribedTokens,
      reconnects,
      latencyMs,
      droppedEvents: this.health.droppedEvents,
      lastSyncAt: latestMessageAt > 0 ? new Date(latestMessageAt).toISOString() : new Date().toISOString(),
      workerRunning: true,
      startupPhase,
      diagnostic: normalizedDiagnostic,
      errorSource: this.lastServiceErrorSource ?? null,
      serviceStatus: {
        coreWorker: this.serviceStarted ? 'running' : this.lastServiceError ? 'error' : 'stopped',
        discovery: discoveryState,
        websocket: websocketState,
        dataFreshness,
        activeShards: shardActive,
        totalShards: shards.length,
        lagMs: latencyMs,
        lastUpdateAt: new Date().toISOString(),
        lastError: this.lastServiceError,
        lastErrorSource: this.lastServiceErrorSource ?? null,
      },
    };
    this.emitEvent('app.health', this.health);
  }

  private enqueueMarketTick(row: MarketRow): void {
    this.pendingMarketTickById.set(row.marketId, row);
    if (this.pendingMarketTickTimer) {
      return;
    }

    this.pendingMarketTickTimer = setTimeout(() => {
      this.pendingMarketTickTimer = undefined;
      const rows = Array.from(this.pendingMarketTickById.values());
      this.pendingMarketTickById.clear();
      if (rows.length > 0) {
        this.emitEvent('markets.tick', rows);
        this.queueDashboardTick();
      }
    }, MARKET_TICK_EMIT_INTERVAL_MS);
    this.pendingMarketTickTimer.unref?.();
  }

  private queueDashboardTick(): void {
    if (this.pendingDashboardTickTimer) {
      return;
    }

    this.pendingDashboardTickTimer = setTimeout(() => {
      this.pendingDashboardTickTimer = undefined;
      this.emitEvent('dashboard.tick', {
        updatedAt: new Date().toISOString(),
      });
    }, DASHBOARD_TICK_EMIT_INTERVAL_MS);
    this.pendingDashboardTickTimer.unref?.();
  }

  private queuePriceTick(tick: NewPriceTick): void {
    this.pendingPriceTicks.push(tick);
    if (this.pendingPriceTicks.length >= PRICE_TICK_BATCH_LIMIT) {
      this.flushPriceTicks();
      return;
    }
    if (this.priceTickFlushTimer) {
      return;
    }
    this.priceTickFlushTimer = setTimeout(() => {
      this.flushPriceTicks();
    }, PRICE_TICK_BATCH_INTERVAL_MS);
    this.priceTickFlushTimer.unref?.();
  }

  private flushPriceTicks(): void {
    if (this.priceTickFlushTimer) {
      clearTimeout(this.priceTickFlushTimer);
      this.priceTickFlushTimer = undefined;
    }
    if (this.pendingPriceTicks.length === 0) {
      return;
    }
    const batch = this.pendingPriceTicks.splice(0);
    this.repository.insertPriceTicks(batch);
  }

  private runTickArchiveMaintenance(
    retentionDays = this.readSettings().tickRetentionDays,
    options?: { allowCompaction?: boolean },
  ): TickArchiveMaintenanceRunSummary {
    const normalizedRetentionDays = normalizeTickRetentionDays(retentionDays);
    this.flushPriceTicks();

    const archiveRepository = this.repository as TickArchiveMaintenanceRepository;
    const archiveCutoffTimestamp =
      Date.now() - normalizedRetentionDays * 24 * 60 * 60 * 1000;
    const archiveTickHistory =
      archiveRepository.archiveAndPrunePriceTicks ??
      archiveRepository.maintainPriceTickArchive ??
      archiveRepository.maintainPriceTicks;

    let totalArchivedRows = 0;
    let totalPrunedRows = 0;
    let totalAggregateRows = 0;
    let checkpointSuggested = false;
    let compactSuggested = false;
    let batchCount = 0;

    let shouldContinue = true;
    while (shouldContinue) {
      const rawResult = archiveRepository.archivePriceTicks
        ? archiveRepository.archivePriceTicks.call(this.repository, {
            cutoffTimestamp: archiveCutoffTimestamp,
            batchSize: TICK_ARCHIVE_BATCH_SIZE,
          })
        : archiveTickHistory
          ? archiveTickHistory.call(this.repository, normalizedRetentionDays)
          : this.repository.prunePriceTicks(normalizedRetentionDays);
      const maintenanceResult = normalizeTickArchiveMaintenanceResult(rawResult);

      totalArchivedRows += maintenanceResult.archivedRows;
      totalPrunedRows += maintenanceResult.prunedRows;
      totalAggregateRows += maintenanceResult.aggregateRows;
      checkpointSuggested ||= maintenanceResult.checkpointSuggested;
      compactSuggested ||= maintenanceResult.compactSuggested;
      batchCount += 1;

      shouldContinue =
        maintenanceResult.hasMore &&
        maintenanceResult.changedRows > 0 &&
        batchCount < MAX_TICK_ARCHIVE_BATCHES_PER_RUN;
    }

    const changedRows = totalArchivedRows + totalPrunedRows + totalAggregateRows;
    if (changedRows <= 0) {
      return {
        changedRows: 0,
        archivedRows: 0,
        prunedRows: 0,
        aggregateRows: 0,
        checkpointed: false,
        compacted: false,
      };
    }

    if (
      compactSuggested ||
      (options?.allowCompaction &&
        totalPrunedRows >= STORAGE_COMPACTION_PRUNE_THRESHOLD)
    ) {
      this.repository.compactDatabase();
      return {
        changedRows,
        archivedRows: totalArchivedRows,
        prunedRows: totalPrunedRows,
        aggregateRows: totalAggregateRows,
        checkpointed: false,
        compacted: true,
      };
    }

    if (checkpointSuggested) {
      this.repository.checkpointWal();
      return {
        changedRows,
        archivedRows: totalArchivedRows,
        prunedRows: totalPrunedRows,
        aggregateRows: totalAggregateRows,
        checkpointed: true,
        compacted: false,
      };
    }

    return {
      changedRows,
      archivedRows: totalArchivedRows,
      prunedRows: totalPrunedRows,
      aggregateRows: totalAggregateRows,
      checkpointed: false,
      compacted: false,
    };
  }

  private pruneAlertHistory(
    retentionDays = this.readSettings().alertRetentionDays,
    options?: { allowCompaction?: boolean },
  ): AlertHistoryMaintenanceRunSummary {
    const prunedRows = this.repository.pruneAlertEvents(normalizeAlertRetentionDays(retentionDays));
    if (prunedRows <= 0) {
      return {
        prunedRows: 0,
        checkpointed: false,
        compacted: false,
      };
    }

    this.refreshUnackedAlertIndex();
    this.refreshBubbleAlertIndex();
    const changedBubbleMarketIds = this.recomputeBubbleScores();
    if (changedBubbleMarketIds.length > 0) {
      this.emitBubbleScoreTicks(changedBubbleMarketIds);
      this.queueDashboardTick();
    }

    if (options?.allowCompaction && prunedRows >= STORAGE_COMPACTION_PRUNE_THRESHOLD) {
      this.repository.compactDatabase();
      return {
        prunedRows,
        checkpointed: false,
        compacted: true,
      };
    }

    this.repository.checkpointWal();
    return {
      prunedRows,
      checkpointed: true,
      compacted: false,
    };
  }

  private runStorageMaintenance(
    reason: Exclude<StorageMaintenanceSummary['lastReason'], null>,
    options?: { allowCompaction?: boolean },
  ): Promise<StorageMaintenanceResult> {
    if (this.maintenanceInFlight) {
      return this.maintenanceInFlight;
    }

    const startedAtMs = Date.now();
    const startedAtIso = new Date(startedAtMs).toISOString();
    this.maintenanceSummary = {
      ...this.maintenanceSummary,
      status: 'running',
      lastRunAt: startedAtIso,
      lastDurationMs: null,
      lastReason: reason,
      lastError: null,
    };

    this.maintenanceInFlight = (async () => {
      try {
        const tickSummary = this.runTickArchiveMaintenance(undefined, options);
        const alertSummary = this.pruneAlertHistory(undefined, options);
        const finishedAtIso = new Date().toISOString();
        const didCheckpoint = tickSummary.checkpointed || alertSummary.checkpointed;
        const didCompact = tickSummary.compacted || alertSummary.compacted;
        this.maintenanceSummary = {
          ...this.maintenanceSummary,
          status: 'success',
          lastRunAt: startedAtIso,
          lastSuccessAt: finishedAtIso,
          lastDurationMs: Date.now() - startedAtMs,
          lastArchivedRows: tickSummary.archivedRows,
          lastPrunedTickRows: tickSummary.prunedRows,
          lastPrunedAlertRows: alertSummary.prunedRows,
          lastCheckpointAt: didCheckpoint
            ? finishedAtIso
            : this.maintenanceSummary.lastCheckpointAt,
          lastCompactionAt: didCompact
            ? finishedAtIso
            : this.maintenanceSummary.lastCompactionAt,
          lastReason: reason,
          lastError: null,
        };
        return {
          summary: { ...this.maintenanceSummary },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.maintenanceSummary = {
          ...this.maintenanceSummary,
          status: 'error',
          lastRunAt: startedAtIso,
          lastDurationMs: Date.now() - startedAtMs,
          lastReason: reason,
          lastError: message,
        };
        throw error;
      } finally {
        this.maintenanceInFlight = null;
      }
    })();

    return this.maintenanceInFlight;
  }

  private startMaintenanceLoop(): void {
    if (this.maintenanceTimer) {
      return;
    }

    if (this.startupMaintenanceTimer) {
      clearTimeout(this.startupMaintenanceTimer);
    }
    this.startupMaintenanceTimer = setTimeout(() => {
      this.startupMaintenanceTimer = undefined;
      void this.runStorageMaintenance('startup').catch(() => undefined);
    }, STARTUP_MAINTENANCE_DELAY_MS);
    this.startupMaintenanceTimer.unref?.();

    this.maintenanceTimer = setInterval(() => {
      try {
        this.marketState.pruneOlderThan(Date.now() - 24 * 60 * 60 * 1000);
        this.prunePriceWindows(Date.now() - PRICE_CHANGE_WINDOW_MS);
        void this.runStorageMaintenance('scheduled').catch(() => undefined);
      } catch (error) {
        console.error('[worker-runtime] scheduled maintenance failed', error);
      }
    }, MAINTENANCE_INTERVAL_MS);
    this.maintenanceTimer.unref?.();
  }

  private prunePriceWindows(cutoffTimestamp: number): void {
    for (const [tokenId, entries] of this.priceWindowByToken.entries()) {
      const trimmed = entries.filter((entry) => entry.timestamp >= cutoffTimestamp);
      if (trimmed.length === 0) {
        this.priceWindowByToken.delete(tokenId);
        continue;
      }
      this.priceWindowByToken.set(tokenId, trimmed);
    }
  }

  private emitEvent(
    channel: 'app.health',
    payload: AppHealth,
  ): void;
  private emitEvent(
    channel: 'markets.tick',
    payload: MarketRow[] | MarketQueryResult,
  ): void;
  private emitEvent(channel: 'dashboard.tick', payload: DashboardTickPayload): void;
  private emitEvent(channel: 'alerts.new', payload: AlertEvent): void;
  private emitEvent(
    channel: 'app.health' | 'dashboard.tick' | 'markets.tick' | 'alerts.new',
    payload: unknown,
  ): void {
    this.port.postMessage({
      kind: 'event',
      channel,
      payload,
    });
  }

  private respond(message: WorkerResponse): void {
    this.port.postMessage(message);
  }
}

function normalizeWorkerDiagnostic(value: string | null | undefined): string | null {
  if (!value) {
    return value ?? null;
  }

  if (value.includes('姝ｅ湪鍙戠幇甯傚満')) {
    return '正在发现市场...';
  }
  if (value.includes('鏈彂鐜板彲璁㈤槄')) {
    return '未发现可订阅的市场 Token。';
  }
  if (value.includes('鍑嗗 WebSocket')) {
    return '正在准备 WebSocket 分片...';
  }
  if (value.includes('杩炴帴瀹炴椂 WebSocket')) {
    return '正在连接实时 WebSocket...';
  }
  if (value.includes('鍒嗙墖鏆備笉鍙敤')) {
    return '分片暂不可用，正在重试...';
  }
  if (value.includes('WebSocket 鏁版嵁娴佸欢杩')) {
    return value.replace(/WebSocket 鏁版嵁娴佸欢杩燂細/u, 'WebSocket 数据流延迟：');
  }

  return value;
}

function resolveLotteryConfirmation(
  current: MarketTickSnapshot,
  referenceAsk: number,
  currentAsk: number,
  nowMs: number,
): {
  source: LotteryConfirmationSource;
  effectiveSize: number;
  effectiveNotional: number;
} | null {
  const edgeSize = normalizeOptionalNumber(current.removedAskEdge?.previousSize ?? undefined);
  const edgePrice = normalizeOptionalNumber(current.removedAskEdge?.previousPrice);
  if (
    edgeSize !== undefined &&
    edgePrice !== undefined &&
    Math.abs(edgePrice - referenceAsk) <= LOTTERY_SIGNAL_TRADE_TOLERANCE
  ) {
    const edgeNotional = edgeSize * edgePrice;
    if (edgeSize >= LOTTERY_SIGNAL_MIN_SIZE || edgeNotional >= LOTTERY_SIGNAL_MIN_NOTIONAL) {
      return {
        source: 'edge_volume',
        effectiveSize: edgeSize,
        effectiveNotional: edgeNotional,
      };
    }
  }

  const lastTradeSize = normalizeOptionalNumber(current.lastTradeSize);
  const lastTradePrice = normalizeOptionalNumber(current.lastTradePrice);
  const lastTradeAt = current.lastTradeAt;
  if (
    lastTradeSize !== undefined &&
    lastTradePrice !== undefined &&
    lastTradeAt !== undefined &&
    nowMs - lastTradeAt >= 0 &&
    nowMs - lastTradeAt <= LOTTERY_SIGNAL_WINDOW_MS &&
    lastTradePrice >= referenceAsk - LOTTERY_SIGNAL_TRADE_TOLERANCE &&
    lastTradePrice <= currentAsk + LOTTERY_SIGNAL_TRADE_TOLERANCE
  ) {
    const tradeNotional = lastTradeSize * lastTradePrice;
    if (lastTradeSize >= LOTTERY_SIGNAL_MIN_SIZE || tradeNotional >= LOTTERY_SIGNAL_MIN_NOTIONAL) {
      return {
        source: 'trade_confirmed',
        effectiveSize: lastTradeSize,
        effectiveNotional: tradeNotional,
      };
    }
  }

  const askSize = normalizeOptionalNumber(current.bestAskSize);
  if (askSize !== undefined) {
    const askNotional = askSize * currentAsk;
    if (askSize >= LOTTERY_SIGNAL_MIN_SIZE || askNotional >= LOTTERY_SIGNAL_MIN_NOTIONAL) {
      return {
        source: 'book_depth',
        effectiveSize: askSize,
        effectiveNotional: askNotional,
      };
    }
  }

  const visibleAskSize = normalizeOptionalNumber(current.askVisibleSize);
  if (visibleAskSize !== undefined) {
    const visibleNotional = visibleAskSize * currentAsk;
    if (
      visibleAskSize >= LOTTERY_SIGNAL_MIN_SIZE ||
      visibleNotional >= LOTTERY_SIGNAL_MIN_NOTIONAL
    ) {
      return {
        source: 'book_depth',
        effectiveSize: visibleAskSize,
        effectiveNotional: visibleNotional,
      };
    }
  }

  return null;
}

function resolveLotteryMinLift(referenceAsk: number): number {
  if (referenceAsk <= 0.02) {
    return 0.03;
  }

  if (referenceAsk <= LOTTERY_SIGNAL_REFERENCE_ASK_MAX) {
    return 0.04;
  }

  return LOTTERY_SIGNAL_DEFAULT_MIN_LIFT;
}

function parseIsoTime(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareDashboardAlertRows(
  left: { triggeredAt: number },
  right: { triggeredAt: number },
): number {
  return right.triggeredAt - left.triggeredAt;
}

function incrementDashboardAlertCounter(
  map: Map<string, number>,
  key: string | null | undefined,
): void {
  if (!key) {
    return;
  }
  map.set(key, (map.get(key) ?? 0) + 1);
}

function decrementDashboardAlertCounter(
  map: Map<string, number>,
  key: string | null | undefined,
): void {
  if (!key) {
    return;
  }

  const nextValue = (map.get(key) ?? 0) - 1;
  if (nextValue > 0) {
    map.set(key, nextValue);
    return;
  }

  map.delete(key);
}

function isNewerDashboardAlert(
  left: DashboardUnackedAlertRow,
  right: DashboardUnackedAlertRow,
): boolean {
  if (left.triggeredAt !== right.triggeredAt) {
    return left.triggeredAt > right.triggeredAt;
  }

  return left.id.localeCompare(right.id) > 0;
}

function isNewerBubbleAlert(left: BubbleAlertRow, right: BubbleAlertRow): boolean {
  if (left.triggeredAt !== right.triggeredAt) {
    return left.triggeredAt > right.triggeredAt;
  }

  return left.id.localeCompare(right.id) > 0;
}

function sameBubbleSnapshot(
  left: BubbleSnapshot | undefined,
  right: BubbleSnapshot | undefined,
): boolean {
  return left?.severity === right?.severity && left?.score === right?.score;
}

function buildBubbleSnapshotFromAlert(
  alert: BubbleAlertRow,
  computedAt: number,
  ruleById: Map<string, AlertRule>,
): BubbleSnapshot | undefined {
  const ageMs = computedAt - alert.triggeredAt;
  const severity = resolveBubbleSeverityFromAlertAge(ageMs);
  if (!severity) {
    return undefined;
  }

  const weight = resolveBubbleWeight(
    ruleById.get(alert.ruleId),
    (alert.builtinKey as BuiltinRuleKey | null | undefined) ?? undefined,
  );
  const scoreMultiplier = severity === 'critical' ? 1 : BUBBLE_WEAK_SCORE_MULTIPLIER;
  const score = Math.min(BUBBLE_SCORE_MAX, weight * scoreMultiplier);

  return {
    score: Number(score.toFixed(2)),
    severity,
  };
}

function compareDashboardMarketRows(
  left: MarketRow,
  right: MarketRow,
  leftUnackedCount: number,
  rightUnackedCount: number,
): number {
  const bySeverity = BUBBLE_SEVERITY_RANK[right.bubbleSeverity] - BUBBLE_SEVERITY_RANK[left.bubbleSeverity];
  if (bySeverity !== 0) {
    return bySeverity;
  }
  if (right.bubbleScore !== left.bubbleScore) {
    return right.bubbleScore - left.bubbleScore;
  }
  if (rightUnackedCount !== leftUnackedCount) {
    return rightUnackedCount - leftUnackedCount;
  }
  const byChange = Math.abs(right.change5m) - Math.abs(left.change5m);
  if (Math.abs(byChange) > Number.EPSILON) {
    return byChange;
  }
  const byUpdatedAt = parseIsoTime(right.updatedAt) - parseIsoTime(left.updatedAt);
  if (byUpdatedAt !== 0) {
    return byUpdatedAt;
  }
  return left.marketId.localeCompare(right.marketId);
}

function compareCityBubbleSummaries(
  left: DashboardSnapshot['rows'][number],
  right: DashboardSnapshot['rows'][number],
): number {
  const bySeverity =
    BUBBLE_SEVERITY_RANK[right.cityBubbleSeverity] - BUBBLE_SEVERITY_RANK[left.cityBubbleSeverity];
  if (bySeverity !== 0) {
    return bySeverity;
  }
  if (right.cityBubbleScore !== left.cityBubbleScore) {
    return right.cityBubbleScore - left.cityBubbleScore;
  }
  if (right.unackedAlertCount !== left.unackedAlertCount) {
    return right.unackedAlertCount - left.unackedAlertCount;
  }
  const rightTopChange = Math.abs(right.topMarkets[0]?.change5m ?? 0);
  const leftTopChange = Math.abs(left.topMarkets[0]?.change5m ?? 0);
  if (rightTopChange !== leftTopChange) {
    return rightTopChange - leftTopChange;
  }
  const byUpdatedAt = parseIsoTime(right.updatedAt) - parseIsoTime(left.updatedAt);
  if (byUpdatedAt !== 0) {
    return byUpdatedAt;
  }
  return left.cityName.localeCompare(right.cityName);
}

function resolveDashboardRuleName(
  ruleId: string,
  builtinKey: string | null | undefined,
  ruleById: Map<string, AlertRule>,
): string {
  const normalizedBuiltinKey =
    (builtinKey as BuiltinRuleKey | undefined) ??
    ruleById.get(ruleId)?.builtinKey ??
    undefined;
  if (normalizedBuiltinKey && BUILTIN_RULE_DISPLAY_NAMES_ZH[normalizedBuiltinKey]) {
    return BUILTIN_RULE_DISPLAY_NAMES_ZH[normalizedBuiltinKey];
  }

  const rule = ruleById.get(ruleId);
  if (rule?.name?.trim()) {
    return rule.name;
  }

  return formatBuiltinRuleName(normalizedBuiltinKey, 'zh-CN') ?? ruleId;
}

function resolveBubbleWeight(
  rule: Pick<EngineAlertRule, 'bubbleWeight'> | Pick<AlertRule, 'bubbleWeight'> | undefined,
  builtinKey?: BuiltinRuleKey,
): number {
  const fallback = builtinKey ? BUBBLE_WEIGHT_DEFAULTS[builtinKey] : CUSTOM_RULE_BUBBLE_WEIGHT;
  const candidate = rule?.bubbleWeight;
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
    return fallback;
  }
  return Math.max(0, Math.min(candidate, BUBBLE_SCORE_MAX));
}

function resolveBubbleSeverityFromAlertAge(
  ageMs: number,
): Exclude<MarketRow['bubbleSeverity'], 'none'> | null {
  if (ageMs < 0 || !Number.isFinite(ageMs)) {
    return null;
  }
  return ageMs <= BUBBLE_STRONG_ALERT_WINDOW_MS ? 'critical' : 'warning';
}

function mapUiRuleToEngine(rule: AlertRule): EngineAlertRule {
  const metric = mapUiMetricToEngine(rule.metric);
  const operator =
    metric === 'liquidity_kill' || metric === 'volume_pricing'
      ? '>='
      : rule.operator === 'crosses'
        ? 'crosses_above'
        : (rule.operator as EngineAlertRule['operator']);
  const builtinKey = rule.builtinKey ?? inferBuiltinRuleKey(rule.id);
  const dedupeWindowSec =
    typeof rule.dedupeWindowSec === 'number' && Number.isFinite(rule.dedupeWindowSec)
      ? Math.max(0, Math.trunc(rule.dedupeWindowSec))
      : Math.max(30, Math.floor(rule.cooldownSec / 2));
  const quietHours = rule.quietHours;
  return {
    id: rule.id,
    name: rule.name,
    isBuiltin: rule.isBuiltin ?? Boolean(builtinKey),
    builtinKey,
    enabled: rule.enabled,
    metric,
    operator,
    threshold: rule.threshold,
    windowSec: rule.windowSec,
    cooldownSec: rule.cooldownSec,
    dedupeWindowSec,
    bubbleWeight: resolveBubbleWeight(rule, builtinKey),
    severity: uiToEngineSeverity(rule.severity),
    soundProfileId: rule.soundProfileId || undefined,
    liquiditySide: normalizeLiquiditySide(rule.liquiditySide),
    scope: {
      cityKey: rule.scope?.cityKey || undefined,
      seriesSlug: rule.scope?.seriesSlug || undefined,
      eventDate: rule.scope?.eventDate || undefined,
      temperatureBand: rule.scope?.temperatureBand || undefined,
      marketId: rule.scope?.marketId || undefined,
      tokenId: rule.scope?.tokenId || undefined,
      side: toEngineScopeSide(rule.scope?.side),
    },
    quietHours,
  };
}

function mapEngineRuleToUi(
  rule: EngineAlertRule,
  settings: Pick<AppSettings, 'quietHoursStart' | 'quietHoursEnd'> = DEFAULT_SETTINGS,
): AlertRule {
  const metric = normalizeLegacyEngineMetric(rule.metric as string);
  const builtinKey = rule.builtinKey ?? inferBuiltinRuleKey(rule.id);
  const defaultQuietHours = buildQuietHoursFromSettings(settings);
  const quietHours = isSameQuietHours(rule.quietHours, defaultQuietHours)
    ? undefined
    : rule.quietHours;
  return {
    id: rule.id,
    name: formatBuiltinRuleName(builtinKey, 'zh-CN') ?? rule.name,
    isBuiltin: rule.isBuiltin ?? Boolean(builtinKey),
    builtinKey,
    metric: mapEngineMetricToUi(metric),
    operator:
      metric === 'liquidity_kill' || metric === 'volume_pricing'
        ? '>='
        : rule.operator === 'crosses_above' || rule.operator === 'crosses_below'
          ? 'crosses'
          : (rule.operator as AlertRule['operator']),
    threshold: rule.threshold,
    windowSec: rule.windowSec,
    cooldownSec: rule.cooldownSec,
    dedupeWindowSec: rule.dedupeWindowSec,
    bubbleWeight: resolveBubbleWeight(rule, builtinKey),
    severity: severityToUi(rule.severity),
    enabled: rule.enabled,
    soundProfileId: rule.soundProfileId ?? '',
    liquiditySide: normalizeLiquiditySide(rule.liquiditySide),
    scope: {
      cityKey: rule.scope?.cityKey ?? '',
      seriesSlug: rule.scope?.seriesSlug ?? '',
      eventDate: rule.scope?.eventDate ?? '',
      temperatureBand: rule.scope?.temperatureBand ?? '',
      marketId: rule.scope?.marketId ?? '',
      tokenId: rule.scope?.tokenId ?? '',
      side: toUiScopeSide(rule.scope?.side),
    },
    quietHours,
  };
}

function normalizeLegacyEngineRule(rule: EngineAlertRule): EngineAlertRule {
  const metric = normalizeLegacyEngineMetric(rule.metric as string);
  const builtinKey = rule.builtinKey ?? inferBuiltinRuleKey(rule.id);
  const bubbleWeight = resolveBubbleWeight(rule, builtinKey);
  const normalizedRule: EngineAlertRule = {
    ...rule,
    metric,
    operator: metric === 'liquidity_kill' || metric === 'volume_pricing' ? '>=' : rule.operator,
    isBuiltin: rule.isBuiltin ?? Boolean(builtinKey),
    builtinKey,
    bubbleWeight,
    liquiditySide: normalizeLiquiditySide(rule.liquiditySide),
  };
  const harmonizedRule = harmonizeBuiltinRuleDefaults(normalizedRule);
  if (
    harmonizedRule.metric === rule.metric &&
    harmonizedRule.builtinKey === rule.builtinKey &&
    harmonizedRule.bubbleWeight === rule.bubbleWeight &&
    harmonizedRule.operator === rule.operator &&
    harmonizedRule.threshold === rule.threshold &&
    harmonizedRule.windowSec === rule.windowSec &&
    harmonizedRule.cooldownSec === rule.cooldownSec &&
    harmonizedRule.dedupeWindowSec === rule.dedupeWindowSec &&
    harmonizedRule.liquiditySide === rule.liquiditySide
  ) {
    return harmonizedRule;
  }
  return harmonizedRule;
}

function normalizeLiquiditySide(
  side: 'buy' | 'sell' | 'both' | null | undefined,
): 'buy' | 'sell' | 'both' | undefined {
  if (side === 'buy' || side === 'sell' || side === 'both') {
    return side;
  }
  return undefined;
}

function harmonizeBuiltinRuleDefaults(rule: EngineAlertRule): EngineAlertRule {
  if (rule.builtinKey !== 'liquidity_kill') {
    return rule;
  }

  const looksLegacyDefault =
    (rule.operator === '<=' || rule.operator === '<') &&
    Math.abs(rule.threshold - 0.01) < Number.EPSILON &&
    rule.windowSec === 60 &&
    rule.cooldownSec === 180 &&
    rule.dedupeWindowSec === 90;

  if (!looksLegacyDefault) {
    return {
      ...rule,
      liquiditySide: normalizeLiquiditySide(rule.liquiditySide) ?? 'both',
    };
  }

  return {
    ...rule,
    name: formatBuiltinRuleName('liquidity_kill', 'zh-CN') ?? rule.name,
    operator: '>=',
    threshold: 0.2,
    windowSec: 30,
    cooldownSec: 120,
    dedupeWindowSec: 60,
    liquiditySide: 'both',
  };
}

function inferBuiltinRuleKey(ruleId: string): BuiltinRuleKey | undefined {
  switch (ruleId) {
    case 'price-change-5m':
      return 'price_change_5m';
    case 'spread-threshold':
      return 'spread_threshold';
    case 'feed-stale':
      return 'feed_stale';
    case 'liquidity-kill':
      return 'liquidity_kill';
    case 'volume-pricing':
      return 'volume_pricing';
    default:
      return undefined;
  }
}

function mapUiMetricToEngine(metric: AlertRule['metric']): EngineAlertRule['metric'] {
  const normalized = String(metric).trim().toLowerCase();
  switch (normalized) {
    case 'price':
    case 'price_threshold':
      return 'price_threshold';
    case 'change5m':
    case 'price_change_pct':
      return 'price_change_pct';
    case 'liquidity_kill':
    case 'liquidity-kill':
    case 'liquiditykill':
      return 'liquidity_kill';
    case 'volume_pricing':
    case 'volume-pricing':
    case 'volumepricing':
      return 'volume_pricing';
    case 'feed_stale':
    case 'feed-stale':
      return 'feed_stale';
    case 'spread':
    case 'spread_threshold':
    case 'bidask_gap':
    default:
      return 'spread_threshold';
  }
}

function normalizeLegacyEngineMetric(metric: string): EngineAlertRule['metric'] {
  const normalized = metric.trim().toLowerCase();
  switch (normalized) {
    case 'price_threshold':
    case 'price':
      return 'price_threshold';
    case 'price_change_pct':
    case 'change5m':
      return 'price_change_pct';
    case 'feed_stale':
    case 'feed-stale':
      return 'feed_stale';
    case 'liquidity_kill':
    case 'liquidity-kill':
    case 'liquiditykill':
      return 'liquidity_kill';
    case 'volume_pricing':
    case 'volume-pricing':
    case 'volumepricing':
      return 'volume_pricing';
    case 'spread_threshold':
    case 'spread':
    case 'bidask_gap':
    default:
      return 'spread_threshold';
  }
}

function mapEngineMetricToUi(metric: EngineAlertRule['metric']): AlertRule['metric'] {
  switch (metric) {
    case 'price_threshold':
      return 'price';
    case 'price_change_pct':
      return 'change5m';
    case 'feed_stale':
      return 'feed_stale';
    case 'liquidity_kill':
      return 'liquidity_kill';
    case 'volume_pricing':
      return 'volume_pricing';
    case 'spread_threshold':
    default:
      return 'spread';
  }
}

const classifyDataServiceErrorSource = (message: string): HealthErrorSource => {
  const normalized = message.toLowerCase();
  if (
    normalized.includes('packaged resources') ||
    normalized.includes('cannot find module') ||
    normalized.includes('err_module_not_found')
  ) {
    return 'packaging';
  }
  if (
    normalized.includes('mask is not a function') ||
    normalized.includes('websocket') ||
    normalized.includes(' ws ')
  ) {
    return 'ws';
  }
  if (
    normalized.includes('sqlite') ||
    normalized.includes('better-sqlite3') ||
    normalized.includes('database')
  ) {
    return 'db';
  }
  if (normalized.includes('discover') || normalized.includes('gamma')) {
    return 'discovery';
  }
  if (
    normalized.includes('econn') ||
    normalized.includes('enotfound') ||
    normalized.includes('etimedout') ||
    normalized.includes('network') ||
    normalized.includes('proxy') ||
    normalized.includes('tls')
  ) {
    return 'network';
  }
  if (!normalized.trim()) {
    return 'unknown';
  }
  return 'worker';
};
