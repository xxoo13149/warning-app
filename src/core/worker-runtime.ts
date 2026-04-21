import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MessagePort } from 'node:worker_threads';

import { AlertEngine } from './alerts/engine';
import type { AlertRule as EngineAlertRule, AlertSeverity, AlertTrigger } from './alerts/types';
import { WeatherMonitorRepository } from './db/repository';
import type {
  CityConfig as DbCityConfig,
  LatestTokenState as DbLatestTokenState,
  NewPriceTick,
  TrackedMarket as DbTrackedMarket,
} from './db/schema';
import type { NormalizedEvent, ShardStatusEvent, TokenRuntimeState } from './polymarket/types';
import { PolymarketDataService } from './services/polymarket-data-service';
import { FeedStateStore, MarketStateStore } from './state/market-state';
import {
  formatAlertMessage,
  formatBuiltinRuleName,
  type AlertMarketSnapshot,
  type BuiltinRuleKey,
} from '../shared/alert-display';
import { DEFAULT_CITY_CONFIGS } from '../shared/city-seeds';
import {
  BUILTIN_DEFAULT_SOUND_ID,
  BUILTIN_SOUND_LIBRARY,
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
  AlertRule,
  AppHealth,
  AppSettings,
  DashboardQuery,
  DashboardSnapshot,
  DashboardTickPayload,
  HealthErrorSource,
  MarketQuery,
  MarketQueryResult,
  MarketRow,
  RegisterSoundPayload,
  RulePreviewResult,
  SettingsPayload,
  SoundProfile,
} from '../renderer/types/contracts';
import { DEFAULT_HEALTH, DEFAULT_SETTINGS } from '../main/contracts/ipc';

const APP_SETTING_KEYS = {
  startOnBoot: 'startOnBoot',
  backgroundAudio: 'backgroundAudio',
  reconnectPolicy: 'reconnectPolicy',
  pollIntervalSec: 'pollIntervalSec',
  selectedSoundProfileId: 'selectedSoundProfileId',
  quietHoursStart: 'quietHoursStart',
  quietHoursEnd: 'quietHoursEnd',
} as const;

type RuleSavePayload = WorkerInvokePayloadMap['rules.save'];
type RulePreviewPayload = WorkerInvokePayloadMap['rules.preview'];

const BUILTIN_RULE_DISPLAY_NAMES_ZH: Record<BuiltinRuleKey, string> = {
  feed_stale: '数据流停滞',
  liquidity_kill: '流动性斩杀',
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
    name: formatBuiltinRuleName('liquidity_kill', 'zh-CN') ?? '流动性消失',
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
    soundProfileId: '',
    scope: {},
  },
];

const severityToUi = (severity: AlertSeverity): AlertEvent['severity'] => {
  if (severity === 'critical') return 'critical';
  if (severity === 'high' || severity === 'medium') return 'warning';
  return 'info';
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
const MAINTENANCE_INTERVAL_MS = 30 * 60 * 1000;
const BUBBLE_SCORE_RECOMPUTE_INTERVAL_MS = 60 * 1000;
const BUBBLE_ALERT_LOOKBACK_MS = 15 * 60 * 1000;
const BUBBLE_SCORE_MAX = 100;
const DASHBOARD_MAX_VISIBLE_CITIES = 48;
const CUSTOM_RULE_BUBBLE_WEIGHT = 60;
const BUBBLE_WEIGHT_DEFAULTS: Record<BuiltinRuleKey, number> = {
  feed_stale: 95,
  liquidity_kill: 90,
  spread_threshold: 70,
  price_change_5m: 55,
};
const BUBBLE_SEVERITY_MULTIPLIER: Record<
  Exclude<MarketRow['bubbleSeverity'], 'none'>,
  number
> = {
  critical: 1,
  warning: 0.65,
  info: 0.35,
};
const BUBBLE_SEVERITY_RANK: Record<MarketRow['bubbleSeverity'], number> = {
  none: 0,
  info: 1,
  warning: 2,
  critical: 3,
};

export class WorkerRuntime {
  private readonly port: MessagePort;
  private readonly repository: WeatherMonitorRepository;
  private readonly dataService: PolymarketDataService;
  private readonly builtinSoundDir: string | null;
  private readonly marketState = new MarketStateStore();
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
  private bubbleSnapshotByMarketId = new Map<string, BubbleSnapshot>();
  private bubbleScoreUpdatedAt = new Date(0).toISOString();
  private bubbleScoreTimer?: ReturnType<typeof setInterval>;
  private serviceStarted = false;
  private serviceRetryTimer?: ReturnType<typeof setTimeout>;
  private maintenanceTimer?: ReturnType<typeof setInterval>;
  private lastServiceError: string | null = null;
  private hasSuccessfulDiscovery = false;

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
    this.builtinSoundDir = bootstrapData.builtinSoundDir ?? null;
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
    this.startMaintenanceLoop();
    await this.ensureDataServiceStarted();
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
        return this.listAlerts(payload as { limit?: number; acknowledged?: boolean } | undefined) as WorkerInvokeResultMap[C];
      case 'alerts.ack':
        return this.ackAlerts(payload as WorkerInvokePayloadMap['alerts.ack']) as WorkerInvokeResultMap[C];
      case 'rules.list':
        return { rows: [...this.uiRules] } as WorkerInvokeResultMap[C];
      case 'rules.preview':
        return this.previewRule(payload as RulePreviewPayload) as WorkerInvokeResultMap[C];
      case 'rules.save':
        return this.saveRules(payload as RuleSavePayload) as WorkerInvokeResultMap[C];
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
    if (!this.builtinSoundDir) {
      return;
    }

    const soundProfiles = BUILTIN_SOUND_LIBRARY.map((sound) => ({
      id: sound.id,
      name: sound.nameEn,
      filePath: path.join(this.builtinSoundDir ?? '', sound.fileName),
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
    const rules = this.repository.queryAlertRules(false).map(normalizeLegacyEngineRule);
    this.engineRules = rules;
    const settings = this.readSettings();
    this.uiRules = rules.map((rule) => mapEngineRuleToUi(rule, settings));
  }

  private startBubbleScoreLoop(): void {
    if (this.bubbleScoreTimer) {
      return;
    }
    this.bubbleScoreTimer = setInterval(() => {
      this.recomputeBubbleScores();
      this.emitBubbleScoreTicks();
    }, BUBBLE_SCORE_RECOMPUTE_INTERVAL_MS);
    this.bubbleScoreTimer.unref?.();
  }

  private recomputeBubbleScores(): void {
    const computedAt = Date.now();
    const recentAlerts = this.repository.queryRecentAlertEventsForScoring(
      computedAt - BUBBLE_ALERT_LOOKBACK_MS,
    );
    const ruleById = new Map(this.uiRules.map((rule) => [rule.id, rule]));
    const contributionMap = new Map<
      string,
      Array<{ value: number; severity: Exclude<MarketRow['bubbleSeverity'], 'none'> }>
    >();

    for (const alert of recentAlerts) {
      if (!alert.marketId) {
        continue;
      }

      const ageMs = computedAt - alert.triggeredAt;
      if (ageMs < 0 || ageMs >= BUBBLE_ALERT_LOOKBACK_MS) {
        continue;
      }

      const severity = severityToUi(alert.severity as AlertSeverity);
      const weight = resolveBubbleWeight(
        ruleById.get(alert.ruleId),
        (alert.builtinKey as BuiltinRuleKey | null | undefined) ?? undefined,
      );
      const decay = 1 - ageMs / BUBBLE_ALERT_LOOKBACK_MS;
      const value = weight * BUBBLE_SEVERITY_MULTIPLIER[severity] * decay;
      if (value <= 0) {
        continue;
      }

      const list = contributionMap.get(alert.marketId) ?? [];
      list.push({ value, severity });
      contributionMap.set(alert.marketId, list);
    }

    const next = new Map<string, BubbleSnapshot>();
    for (const [marketId, contributions] of contributionMap.entries()) {
      const ordered = [...contributions].sort((left, right) => right.value - left.value);
      const [primary, ...rest] = ordered;
      if (!primary) {
        continue;
      }

      const secondary = rest.reduce((sum, item) => sum + item.value, 0);
      const score = Math.min(BUBBLE_SCORE_MAX, primary.value + secondary * 0.25);
      const severity = ordered.reduce<MarketRow['bubbleSeverity']>(
        (highest, item) =>
          BUBBLE_SEVERITY_RANK[item.severity] > BUBBLE_SEVERITY_RANK[highest]
            ? item.severity
            : highest,
        'none',
      );

      next.set(marketId, {
        score: Number(score.toFixed(2)),
        severity,
      });
    }

    this.bubbleSnapshotByMarketId = next;
    this.bubbleScoreUpdatedAt = new Date(computedAt).toISOString();
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
      this.handleDiscovery(universe.events);
      this.hasSuccessfulDiscovery = true;
      this.clearServiceError();
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
      });
    });
  }

  private handleDiscovery(events: NormalizedEvent[]): void {
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
  }

  private refreshIndexes(): void {
    this.refreshCityIndex();
    this.refreshTrackedMarketIndex();
    this.refreshLatestTokenStateIndex();
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
    this.marketState.recordTick({
      tokenId: tokenState.tokenId,
      marketId: meta.marketId,
      cityKey: meta.cityKey,
      seriesSlug: meta.seriesSlug,
      eventDate: meta.eventDate,
      temperatureBand: meta.temperatureBand,
      side: meta.side,
      timestamp,
      lastTradePrice: tokenState.lastTradePrice,
      bestBid: tokenState.bestBid,
      bestAsk: tokenState.bestAsk,
      spread: tokenState.spread,
      lastMessageAt: timestamp,
    });

    const triggers = this.alertEngine.evaluateMarketTick(this.engineRules, {
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
      bestBid: tokenState.bestBid,
      bestAsk: tokenState.bestAsk,
      spread: tokenState.spread,
      lastMessageAt: timestamp,
    });

    this.persistAndEmitAlerts(triggers);

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

  private persistAndEmitAlerts(triggers: AlertTrigger[]): void {
    if (triggers.length === 0) {
      return;
    }
    const ruleById = new Map(this.uiRules.map((rule) => [rule.id, rule]));
    const enriched = triggers.map((trigger) => {
      const marketSnapshot = trigger.marketId
        ? this.buildAlertMarketSnapshot(trigger.marketId)
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
    this.recomputeBubbleScores();
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
      });
    }
    this.queueDashboardTick();
  }

  private queryMarkets(query: MarketQuery | undefined): MarketQueryResult {
    const rows = this.buildMarketRows();
    let filtered = rows;

    if (query?.cityKey) {
      filtered = filtered.filter((row) => row.cityKey === query.cityKey);
    }
    if (query?.eventDate) {
      filtered = filtered.filter((row) => row.eventDate === query.eventDate);
    }
    if (query?.watchlistedOnly) {
      filtered = filtered.filter((row) => row.watchlisted);
    }

    const sortBy = query?.sortBy ?? 'updatedAt';
    const sortDir = query?.sortDir ?? 'desc';
    filtered = filtered.sort((left, right) => {
      const direction = sortDir === 'asc' ? 1 : -1;
      const toComparable = (row: MarketRow): number =>
        sortBy === 'volume24h'
          ? row.volume24h
          : sortBy === 'change5m'
            ? row.change5m
            : sortBy === 'spread'
              ? row.spread ?? -1
              : Date.parse(row.updatedAt);
      return (toComparable(left) - toComparable(right)) * direction;
    });

    const limit = Math.max(1, Math.min(query?.limit ?? 2000, 2000));
    return {
      rows: filtered.slice(0, limit),
      total: filtered.length,
    };
  }

  private queryDashboard(query: DashboardQuery | undefined): DashboardSnapshot {
    const rows = this.buildMarketRows();
    const availableDates = Array.from(new Set(rows.map((row) => row.eventDate))).sort((left, right) =>
      right.localeCompare(left),
    );
    const requestedDate = query?.eventDate?.trim() ?? '';
    const selectedDate = availableDates.includes(requestedDate)
      ? requestedDate
      : (availableDates[0] ?? requestedDate);
    const scope = query?.scope ?? 'risk';
    const rowsForDate = selectedDate
      ? rows.filter((row) => row.eventDate === selectedDate)
      : [];
    const unackedAlerts = this.repository.queryAlertEvents({
      acknowledged: false,
      limit: 5000,
    });
    const unackedCountByMarketId = new Map<string, number>();
    const unackedCountByCityKey = new Map<string, number>();
    const alertsByMarketId = new Map<string, typeof unackedAlerts>();
    const ruleById = new Map(this.uiRules.map((rule) => [rule.id, rule]));

    for (const alert of unackedAlerts) {
      if (alert.cityKey) {
        unackedCountByCityKey.set(
          alert.cityKey,
          (unackedCountByCityKey.get(alert.cityKey) ?? 0) + 1,
        );
      }

      if (!alert.marketId) {
        continue;
      }

      unackedCountByMarketId.set(
        alert.marketId,
        (unackedCountByMarketId.get(alert.marketId) ?? 0) + 1,
      );
      const items = alertsByMarketId.get(alert.marketId) ?? [];
      items.push(alert);
      alertsByMarketId.set(alert.marketId, items);
    }

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
          unackedCountByMarketId.get(left.marketId) ?? 0,
          unackedCountByMarketId.get(right.marketId) ?? 0,
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
      const dominantAlert = [...(alertsByMarketId.get(dominantMarket.marketId) ?? [])].sort(
        compareDashboardAlertRows,
      )[0];
      const updatedAtMs = Math.max(...cityRows.map((row) => parseIsoTime(row.updatedAt)));

      summaries.push({
        cityKey,
        cityName: dominantMarket.cityName,
        airportCode: dominantMarket.airportCode || null,
        eventDate: selectedDate,
        marketCount: cityRows.length,
        watchlisted: cityRows.some((row) => row.watchlisted),
        unackedAlertCount: unackedCountByCityKey.get(cityKey) ?? 0,
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

  private listAlerts(query: { limit?: number; acknowledged?: boolean } | undefined): {
    rows: AlertEvent[];
    total: number;
  } {
    const rows = this.repository.queryAlertEvents({
      limit: query?.limit ?? 200,
      acknowledged: query?.acknowledged,
    });
    const ruleById = new Map(this.uiRules.map((rule) => [rule.id, rule]));
    return {
      rows: rows.map((row) => ({
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
      total: rows.length,
    };
  }

  private ackAlerts(payload: WorkerInvokePayloadMap['alerts.ack']): { ok: true; updated: number } {
    const ids = payload.ids ?? (payload.id ? [payload.id] : []);
    let updated = 0;
    for (const id of ids) {
      this.repository.acknowledgeAlertEvent(id);
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
    const scopeSide = rule.scope?.side ?? 'BOTH';

    return {
      matchedCityCount: new Set(rows.map((row) => row.cityKey)).size,
      matchedMarketCount: rows.length,
      sampleMarkets: ordered.slice(0, 3).map((row) => ({
        marketId: row.marketId,
        cityKey: row.cityKey,
        cityName: row.cityName,
        eventDate: row.eventDate,
        temperatureBand: row.temperatureBand,
        side: scopeSide,
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
      dedupeWindowSec:
        typeof rule.dedupeWindowSec === 'number' && Number.isFinite(rule.dedupeWindowSec)
          ? Math.max(0, Math.trunc(rule.dedupeWindowSec))
          : Math.max(30, Math.floor(rule.cooldownSec / 2)),
      bubbleWeight: resolveBubbleWeight(rule, rule.builtinKey),
      soundProfileId: rule.soundProfileId ?? '',
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
    this.uiRules = nextRules;
    const settings = this.readSettings();
    this.engineRules = nextRules.map((rule) => mapUiRuleToEngine(rule, settings));
    this.repository.upsertAlertRules(this.engineRules);
    this.recomputeBubbleScores();
    this.emitBubbleScoreTicks();
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
    return { settings, soundProfiles };
  }

  private updateSettings(patch: Partial<AppSettings>): SettingsPayload {
    const previousSettings = this.readSettings();
    const nextSettings = {
      ...previousSettings,
      ...patch,
    };
    this.writeSettings(nextSettings);
    if (
      patch.quietHoursStart !== undefined ||
      patch.quietHoursEnd !== undefined
    ) {
      this.engineRules = this.uiRules.map((rule) => mapUiRuleToEngine(rule, nextSettings));
      this.repository.upsertAlertRules(this.engineRules);
    }
    this.refreshRulesSync();
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
    const yesPrice =
      yesLatest?.lastTradePrice ??
      yesState?.lastTradePrice ??
      yesLatest?.bestBid ??
      yesState?.bestBid ??
      null;
    const noLatest = this.marketState.getLatest(market.tokenNoId);
    const noPrice =
      noLatest?.lastTradePrice ??
      noState?.lastTradePrice ??
      noLatest?.bestBid ??
      noState?.bestBid ??
      (typeof yesPrice === 'number' ? Math.max(0, 1 - yesPrice) : null);
    const bestBid = yesLatest?.bestBid ?? yesState?.bestBid ?? null;
    const bestAsk = yesLatest?.bestAsk ?? yesState?.bestAsk ?? yesPrice;
    const spread =
      yesLatest?.spread ??
      yesState?.spread ??
      (typeof bestBid === 'number' && typeof bestAsk === 'number'
        ? Math.max(0, bestAsk - bestBid)
        : null);
    const change5m = this.computePriceChangePct(
      market.tokenYesId,
      typeof yesPrice === 'number' ? yesPrice : 0,
      asOfTimestamp,
    );
    const bubbleSnapshot = this.bubbleSnapshotByMarketId.get(market.marketId);

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
    };
  }

  private buildAlertMarketSnapshot(marketId: string): AlertMarketSnapshot | undefined {
    const row = this.buildMarketRow(marketId);
    if (!row) {
      return undefined;
    }
    return {
      cityName: row.cityName,
      eventDate: row.eventDate,
      temperatureBand: row.temperatureBand,
      yesPrice: row.yesPrice,
      bestBid: row.bestBid,
      bestAsk: row.bestAsk,
      spread: row.spread,
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

    private startMaintenanceLoop(): void {
      if (this.maintenanceTimer) {
        return;
      }
      this.maintenanceTimer = setInterval(() => {
        const retentionSetting = this.repository.queryAppSetting('tickRetentionDays')?.value;
        const retentionDays = Number(retentionSetting ?? '7');
        const normalizedDays =
          Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 7;
        this.repository.prunePriceTicks(normalizedDays);
      this.marketState.pruneOlderThan(Date.now() - 24 * 60 * 60 * 1000);
      this.prunePriceWindows(Date.now() - PRICE_CHANGE_WINDOW_MS);
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

function parseIsoTime(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareDashboardAlertRows(
  left: { severity: AlertSeverity | string; triggeredAt: number },
  right: { severity: AlertSeverity | string; triggeredAt: number },
): number {
  const leftSeverity = severityToUi(left.severity as AlertSeverity);
  const rightSeverity = severityToUi(right.severity as AlertSeverity);
  const bySeverity = BUBBLE_SEVERITY_RANK[rightSeverity] - BUBBLE_SEVERITY_RANK[leftSeverity];
  if (bySeverity !== 0) {
    return bySeverity;
  }
  return right.triggeredAt - left.triggeredAt;
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

function mapUiRuleToEngine(
  rule: AlertRule,
  settings: Pick<AppSettings, 'quietHoursStart' | 'quietHoursEnd'> = DEFAULT_SETTINGS,
): EngineAlertRule {
  const metric = mapUiMetricToEngine(rule.metric);
  const operator =
    rule.operator === 'crosses' ? 'crosses_above' : (rule.operator as EngineAlertRule['operator']);
  const builtinKey = rule.builtinKey ?? inferBuiltinRuleKey(rule.id);
  const dedupeWindowSec =
    typeof rule.dedupeWindowSec === 'number' && Number.isFinite(rule.dedupeWindowSec)
      ? Math.max(0, Math.trunc(rule.dedupeWindowSec))
      : Math.max(30, Math.floor(rule.cooldownSec / 2));
  const quietHours = rule.quietHours ?? buildQuietHoursFromSettings(settings);
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
      rule.operator === 'crosses_above' || rule.operator === 'crosses_below'
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
  if (metric === rule.metric && builtinKey === rule.builtinKey && bubbleWeight === rule.bubbleWeight) {
    return rule;
  }
  return {
    ...rule,
    metric,
    isBuiltin: rule.isBuiltin ?? Boolean(builtinKey),
    builtinKey,
    bubbleWeight,
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
