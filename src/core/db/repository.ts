import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { AlertRule, AlertScope, AlertTrigger, QuietHours } from '../alerts';
import type { AlertMessageKey, BuiltinRuleKey } from '../../shared/alert-display';
import {
  alertEvents,
  alertRules,
  appSettings,
  cityConfig,
  feedHealth,
  latestTokenState,
  priceTicks,
  soundProfiles,
  trackedEvents,
  trackedMarkets,
  type AlertEventRow,
  type AlertRuleRow,
  type AppSetting,
  type CityConfig,
  type FeedHealthRow,
  type LatestTokenState,
  type NewAlertEventRow,
  type NewAppSetting,
  type NewCityConfig,
  type NewFeedHealthRow,
  type NewLatestTokenState,
  type NewPriceTick,
  type NewSoundProfile,
  type NewTrackedEvent,
  type NewTrackedMarket,
  type SoundProfile,
  type TrackedEvent,
  type TrackedMarket,
} from './schema';
import { closeDbConnection, createDbConnection, type DbConnection } from './sqlite';

export interface RepositoryOptions {
  dbPath: string;
  nowMs?: () => number;
}

export interface MarketQuery {
  cityKey?: string;
  eventDate?: string;
  seriesSlug?: string;
  activeOnly?: boolean;
}

export interface AlertEventQuery {
  acknowledged?: boolean;
  limit?: number;
  sinceTriggeredAt?: number;
}

export interface FeedHealthQuery {
  status?: string;
}

export class WeatherMonitorRepository {
  private readonly connection: DbConnection;
  private readonly nowMs: () => number;

  constructor(options: RepositoryOptions) {
    this.connection = createDbConnection(options.dbPath);
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  init(): void {
    this.connection.sqlite.pragma('optimize');
  }

  close(): void {
    closeDbConnection(this.connection);
  }

  seedDefaults(): void {
    const now = this.nowMs();
    const settings: NewAppSetting[] = [
      { key: 'tickRetentionDays', value: '7', updatedAt: now },
      { key: 'startupEnabled', value: 'false', updatedAt: now },
      { key: 'alertsMuted', value: 'false', updatedAt: now },
    ];
    for (const setting of settings) {
      this.upsertAppSetting(setting);
    }
  }

  upsertCityConfigs(items: Omit<NewCityConfig, 'updatedAt'>[]): void {
    const now = this.nowMs();
    for (const item of items) {
      this.connection.orm
        .insert(cityConfig)
        .values({
          ...item,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: cityConfig.cityKey,
          set: {
            ...item,
            updatedAt: now,
          },
        })
        .run();
    }
  }

  queryCityConfigs(enabledOnly = false): CityConfig[] {
    if (enabledOnly) {
      return this.connection.orm.select().from(cityConfig).where(eq(cityConfig.enabled, true)).all();
    }
    return this.connection.orm.select().from(cityConfig).all();
  }

  upsertTrackedEvents(items: Omit<NewTrackedEvent, 'updatedAt'>[]): void {
    const now = this.nowMs();
    for (const item of items) {
      this.connection.orm
        .insert(trackedEvents)
        .values({
          ...item,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: trackedEvents.eventId,
          set: {
            ...item,
            updatedAt: now,
          },
        })
        .run();
    }
  }

  queryTrackedEvents(query: MarketQuery = {}): TrackedEvent[] {
    const filters = [];
    if (query.cityKey) {
      filters.push(eq(trackedEvents.cityKey, query.cityKey));
    }
    if (query.eventDate) {
      filters.push(eq(trackedEvents.eventDate, query.eventDate));
    }
    if (query.seriesSlug) {
      filters.push(eq(trackedEvents.seriesSlug, query.seriesSlug));
    }
    if (query.activeOnly) {
      filters.push(eq(trackedEvents.active, true));
      filters.push(eq(trackedEvents.closed, false));
    }

    if (filters.length === 0) {
      return this.connection.orm.select().from(trackedEvents).all();
    }

    return this.connection.orm.select().from(trackedEvents).where(and(...filters)).all();
  }

  upsertTrackedMarkets(items: Omit<NewTrackedMarket, 'updatedAt'>[]): void {
    const now = this.nowMs();
    for (const item of items) {
      this.connection.orm
        .insert(trackedMarkets)
        .values({
          ...item,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: trackedMarkets.marketId,
          set: {
            ...item,
            updatedAt: now,
          },
        })
        .run();
    }
  }

  queryTrackedMarkets(query: MarketQuery = {}): TrackedMarket[] {
    const filters = [];
    if (query.cityKey) {
      filters.push(eq(trackedMarkets.cityKey, query.cityKey));
    }
    if (query.eventDate) {
      filters.push(eq(trackedMarkets.eventDate, query.eventDate));
    }
    if (query.seriesSlug) {
      filters.push(eq(trackedMarkets.seriesSlug, query.seriesSlug));
    }
    if (query.activeOnly) {
      filters.push(eq(trackedMarkets.active, true));
      filters.push(eq(trackedMarkets.closed, false));
    }

    if (filters.length === 0) {
      return this.connection.orm.select().from(trackedMarkets).all();
    }

    return this.connection.orm.select().from(trackedMarkets).where(and(...filters)).all();
  }

  upsertLatestTokenStates(items: Omit<NewLatestTokenState, 'updatedAt'>[]): void {
    const now = this.nowMs();
    for (const item of items) {
      this.connection.orm
        .insert(latestTokenState)
        .values({
          ...item,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: latestTokenState.tokenId,
          set: {
            ...item,
            updatedAt: now,
          },
        })
        .run();
    }
  }

  queryLatestTokenStates(marketId?: string): LatestTokenState[] {
    if (!marketId) {
      return this.connection.orm.select().from(latestTokenState).all();
    }
    return this.connection.orm.select().from(latestTokenState).where(eq(latestTokenState.marketId, marketId)).all();
  }

  insertPriceTicks(items: NewPriceTick[]): void {
    if (items.length === 0) {
      return;
    }
    this.connection.orm.insert(priceTicks).values(items).run();
  }

  queryPriceTicks(tokenId: string, limit = 200): typeof priceTicks.$inferSelect[] {
    return this.connection.orm
      .select()
      .from(priceTicks)
      .where(eq(priceTicks.tokenId, tokenId))
      .orderBy(desc(priceTicks.timestamp))
      .limit(limit)
      .all();
  }

  prunePriceTicks(retentionDays = 7): number {
    const cutoffMs = this.nowMs() - retentionDays * 24 * 60 * 60 * 1000;
    const result = this.connection.orm.delete(priceTicks).where(lte(priceTicks.timestamp, cutoffMs)).run();
    return Number(result.changes ?? 0);
  }

  upsertAlertRules(rulesToUpsert: AlertRule[]): void {
    const now = this.nowMs();
    for (const rule of rulesToUpsert) {
      const row = toAlertRuleRow(rule, now);
      this.connection.orm
        .insert(alertRules)
        .values(row)
        .onConflictDoUpdate({
          target: alertRules.id,
          set: row,
        })
        .run();
    }
  }

  queryAlertRules(enabledOnly = true): AlertRule[] {
    const rows = enabledOnly
      ? this.connection.orm.select().from(alertRules).where(eq(alertRules.enabled, true)).all()
      : this.connection.orm.select().from(alertRules).all();
    return rows.map((row) => fromAlertRuleRow(row));
  }

  insertAlertEvents(items: AlertTrigger[]): void {
    if (items.length === 0) {
      return;
    }

    const rows: NewAlertEventRow[] = items.map((item) => ({
      id: item.id,
      ruleId: item.ruleId,
      builtinKey: item.builtinKey ?? null,
      triggeredAt: item.triggeredAt,
      cityKey: item.cityKey,
      eventId: item.eventId,
      marketId: item.marketId,
      tokenId: item.tokenId,
      message: item.message,
      messageKey: (item.messageKey as AlertMessageKey | undefined) ?? null,
      messageParams: item.messageParams ? JSON.stringify(item.messageParams) : null,
      marketSnapshot: item.marketSnapshot ? JSON.stringify(item.marketSnapshot) : null,
      severity: item.severity,
      dedupeKey: item.dedupeKey,
      acknowledged: false,
    }));
    this.connection.orm.insert(alertEvents).values(rows).run();
  }

  queryAlertEvents(query: AlertEventQuery = {}): AlertEventRow[] {
    const limit = query.limit ?? 200;
    const filters = [];
    if (query.acknowledged !== undefined) {
      filters.push(eq(alertEvents.acknowledged, query.acknowledged));
    }
    if (typeof query.sinceTriggeredAt === 'number') {
      filters.push(gte(alertEvents.triggeredAt, query.sinceTriggeredAt));
    }

    const queryBuilder = this.connection.orm.select().from(alertEvents);
    if (filters.length === 0) {
      return queryBuilder.orderBy(desc(alertEvents.triggeredAt)).limit(limit).all();
    }
    return queryBuilder
      .where(and(...filters))
      .orderBy(desc(alertEvents.triggeredAt))
      .limit(limit)
      .all();
  }

  queryRecentAlertEventsForScoring(sinceTriggeredAt: number): AlertEventRow[] {
    return this.connection.orm
      .select()
      .from(alertEvents)
      .where(gte(alertEvents.triggeredAt, sinceTriggeredAt))
      .orderBy(desc(alertEvents.triggeredAt))
      .all();
  }

  acknowledgeAlertEvent(id: string): void {
    this.connection.orm
      .update(alertEvents)
      .set({
        acknowledged: true,
      })
      .where(eq(alertEvents.id, id))
      .run();
  }

  upsertAppSetting(item: NewAppSetting): void {
    this.connection.orm
      .insert(appSettings)
      .values({
        ...item,
        updatedAt: item.updatedAt ?? this.nowMs(),
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: item.value,
          updatedAt: item.updatedAt ?? this.nowMs(),
        },
      })
      .run();
  }

  queryAppSetting(key: string): AppSetting | undefined {
    return this.connection.orm.select().from(appSettings).where(eq(appSettings.key, key)).get();
  }

  upsertSoundProfiles(items: Omit<NewSoundProfile, 'updatedAt'>[]): void {
    const now = this.nowMs();
    for (const item of items) {
      this.connection.orm
        .insert(soundProfiles)
        .values({
          ...item,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: soundProfiles.id,
          set: {
            ...item,
            updatedAt: now,
          },
        })
        .run();
    }
  }

  querySoundProfiles(enabledOnly = false): SoundProfile[] {
    if (enabledOnly) {
      return this.connection.orm.select().from(soundProfiles).where(eq(soundProfiles.enabled, true)).all();
    }
    return this.connection.orm.select().from(soundProfiles).all();
  }

  upsertFeedHealth(items: Omit<NewFeedHealthRow, 'updatedAt'>[]): void {
    const now = this.nowMs();
    for (const item of items) {
      this.connection.orm
        .insert(feedHealth)
        .values({
          ...item,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: feedHealth.feedKey,
          set: {
            ...item,
            updatedAt: now,
          },
        })
        .run();
    }
  }

  queryFeedHealth(query: FeedHealthQuery = {}): FeedHealthRow[] {
    if (!query.status) {
      return this.connection.orm.select().from(feedHealth).all();
    }
    return this.connection.orm.select().from(feedHealth).where(eq(feedHealth.status, query.status)).all();
  }
}

function toAlertRuleRow(rule: AlertRule, now: number): AlertRuleRow {
  const scope = rule.scope ?? {};
  const quiet = rule.quietHours;
  return {
    id: rule.id,
    name: rule.name,
    isBuiltin: rule.isBuiltin ?? false,
    builtinKey: rule.builtinKey ?? null,
    enabled: rule.enabled,
    metric: rule.metric,
    operator: rule.operator,
    threshold: rule.threshold,
    windowSec: rule.windowSec,
    cooldownSec: rule.cooldownSec,
    dedupeWindowSec: rule.dedupeWindowSec,
    bubbleWeight: rule.bubbleWeight ?? 60,
    severity: rule.severity,
    soundProfileId: rule.soundProfileId ?? null,
    scopeCityKey: scope.cityKey ?? null,
    scopeSeriesSlug: scope.seriesSlug ?? null,
    scopeEventDate: scope.eventDate ?? null,
    scopeTemperatureBand: scope.temperatureBand ?? null,
    scopeMarketId: scope.marketId ?? null,
    scopeTokenId: scope.tokenId ?? null,
    scopeSide: scope.side ?? null,
    quietStartMinute: quiet?.startMinute ?? null,
    quietEndMinute: quiet?.endMinute ?? null,
    updatedAt: now,
  };
}

function fromAlertRuleRow(row: AlertRuleRow): AlertRule {
  const scope: AlertScope = {};
  if (row.scopeCityKey) {
    scope.cityKey = row.scopeCityKey;
  }
  if (row.scopeSeriesSlug) {
    scope.seriesSlug = row.scopeSeriesSlug;
  }
  if (row.scopeEventDate) {
    scope.eventDate = row.scopeEventDate;
  }
  if (row.scopeTemperatureBand) {
    scope.temperatureBand = row.scopeTemperatureBand;
  }
  if (row.scopeMarketId) {
    scope.marketId = row.scopeMarketId;
  }
  if (row.scopeTokenId) {
    scope.tokenId = row.scopeTokenId;
  }
  if (row.scopeSide === 'yes' || row.scopeSide === 'no') {
    scope.side = row.scopeSide;
  }

  let quietHours: QuietHours | undefined;
  if (row.quietStartMinute !== null && row.quietStartMinute !== undefined && row.quietEndMinute !== null && row.quietEndMinute !== undefined) {
    quietHours = {
      startMinute: row.quietStartMinute,
      endMinute: row.quietEndMinute,
    };
  }

  return {
    id: row.id,
    name: row.name,
    isBuiltin: row.isBuiltin,
    builtinKey: (row.builtinKey as BuiltinRuleKey | null | undefined) ?? undefined,
    enabled: row.enabled,
    metric: normalizeAlertMetric(row.metric),
    operator: row.operator as AlertRule['operator'],
    threshold: row.threshold,
    windowSec: row.windowSec,
    cooldownSec: row.cooldownSec,
    dedupeWindowSec: row.dedupeWindowSec,
    bubbleWeight: row.bubbleWeight ?? 60,
    severity: row.severity as AlertRule['severity'],
    soundProfileId: row.soundProfileId ?? undefined,
    scope: Object.keys(scope).length > 0 ? scope : undefined,
    quietHours,
  };
}

function normalizeAlertMetric(metric: string): AlertRule['metric'] {
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
