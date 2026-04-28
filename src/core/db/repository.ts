import path from 'node:path';
import { and, asc, count, desc, eq, gte, inArray, lt, lte, or } from 'drizzle-orm';
import type { AlertRule, AlertScope, AlertTrigger, QuietHours } from '../alerts';
import type { AlertMessageKey, BuiltinRuleKey } from '../../shared/alert-display';
import {
  DEFAULT_ALERT_RETENTION_DAYS,
  DEFAULT_TICK_RETENTION_DAYS,
} from '../../shared/constants';
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
  type PriceTick,
  type SoundProfile,
  type TrackedEvent,
  type TrackedMarket,
} from './schema';
import { archivePriceTickBatch, type TickArchiveMonthResult } from './tick-archive';
import { closeDbConnection, createDbConnection, type DbConnection } from './sqlite';

export interface RepositoryOptions {
  dbPath: string;
  archiveDir?: string;
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
  cursor?: {
    triggeredAt: number;
    id: string;
  };
}

export const ALERT_EVENT_PAGE_LIMIT_DEFAULT = 200;
export const ALERT_EVENT_PAGE_LIMIT_MAX = 500;

export interface AlertEventPage {
  rows: AlertEventRow[];
  total: number;
  hasMore: boolean;
  nextCursor?: {
    triggeredAt: number;
    id: string;
  };
}

export interface FeedHealthQuery {
  status?: string;
}

export interface ArchivePriceTicksQuery {
  cutoffTimestamp: number;
  batchSize?: number;
}

export interface ArchivePriceTicksResult {
  selected: number;
  inserted: number;
  skipped: number;
  deleted: number;
  archivedRows: number;
  prunedRows: number;
  aggregateRows: number;
  checkpointSuggested: boolean;
  hasMore: boolean;
  months: TickArchiveMonthResult[];
}

export class WeatherMonitorRepository {
  private readonly connection: DbConnection;
  private readonly archiveDir: string;
  private readonly nowMs: () => number;

  constructor(options: RepositoryOptions) {
    this.connection = createDbConnection(options.dbPath);
    this.archiveDir = options.archiveDir ?? path.join(path.dirname(options.dbPath), 'archive');
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  init(): void {
    this.connection.sqlite.pragma('optimize');
  }

  close(): void {
    closeDbConnection(this.connection);
  }

  checkpointWal(): void {
    this.connection.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  }

  compactDatabase(): void {
    this.checkpointWal();
    this.connection.sqlite.exec('VACUUM');
    this.checkpointWal();
    this.connection.sqlite.pragma('optimize');
  }

  seedDefaults(): void {
    const now = this.nowMs();
    const settings: NewAppSetting[] = [
      { key: 'tickRetentionDays', value: String(DEFAULT_TICK_RETENTION_DAYS), updatedAt: now },
      { key: 'alertRetentionDays', value: String(DEFAULT_ALERT_RETENTION_DAYS), updatedAt: now },
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

  prunePriceTicks(retentionDays = DEFAULT_TICK_RETENTION_DAYS): number {
    const cutoffMs = this.nowMs() - retentionDays * 24 * 60 * 60 * 1000;
    const result = this.connection.orm.delete(priceTicks).where(lte(priceTicks.timestamp, cutoffMs)).run();
    return Number(result.changes ?? 0);
  }

  archivePriceTicks(queryOrRetentionDays: ArchivePriceTicksQuery | number): ArchivePriceTicksResult {
    const query =
      typeof queryOrRetentionDays === 'number'
        ? {
            cutoffTimestamp:
              this.nowMs() - normalizeRetentionDays(queryOrRetentionDays) * 24 * 60 * 60 * 1000,
          }
        : queryOrRetentionDays;
    const cutoffTimestamp = normalizeCutoffTimestamp(query.cutoffTimestamp);
    const batchSize = normalizeBatchSize(query.batchSize);
    const rows = this.connection.orm
      .select()
      .from(priceTicks)
      .where(lte(priceTicks.timestamp, cutoffTimestamp))
      .orderBy(asc(priceTicks.timestamp), asc(priceTicks.id))
      .limit(batchSize)
      .all();

    if (rows.length === 0) {
      return {
        selected: 0,
        inserted: 0,
        skipped: 0,
        deleted: 0,
        archivedRows: 0,
        prunedRows: 0,
        aggregateRows: 0,
        checkpointSuggested: false,
        hasMore: false,
        months: [],
      };
    }

    const archiveResult = archivePriceTickBatch({
      archiveDir: this.archiveDir,
      ticks: rows.map(mapArchivedPriceTick),
    });

    const deleted = this.deletePriceTicksById(rows.map((row) => row.id));

    return {
      selected: rows.length,
      inserted: archiveResult.inserted,
      skipped: archiveResult.skipped,
      deleted,
      archivedRows: archiveResult.inserted,
      prunedRows: deleted,
      aggregateRows: archiveResult.aggregateRows,
      checkpointSuggested: archiveResult.inserted > 0 || deleted > 0,
      hasMore: this.hasPriceTicksAtOrBefore(cutoffTimestamp),
      months: archiveResult.months,
    };
  }

  pruneAlertEvents(retentionDays = DEFAULT_ALERT_RETENTION_DAYS): number {
    const cutoffMs = this.nowMs() - retentionDays * 24 * 60 * 60 * 1000;
    const result = this.connection.orm
      .delete(alertEvents)
      .where(lte(alertEvents.triggeredAt, cutoffMs))
      .run();
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

  queryAlertEvents(query: AlertEventQuery = {}): AlertEventPage {
    const limit = Math.max(
      1,
      Math.min(query.limit ?? ALERT_EVENT_PAGE_LIMIT_DEFAULT, ALERT_EVENT_PAGE_LIMIT_MAX),
    );
    const baseFilters = [];
    if (query.acknowledged !== undefined) {
      baseFilters.push(eq(alertEvents.acknowledged, query.acknowledged));
    }
    if (typeof query.sinceTriggeredAt === 'number') {
      baseFilters.push(gte(alertEvents.triggeredAt, query.sinceTriggeredAt));
    }

    const totalFilter = baseFilters.length > 0 ? and(...baseFilters) : undefined;
    const totalRow = totalFilter
      ? this.connection.orm
          .select({ value: count() })
          .from(alertEvents)
          .where(totalFilter)
          .get()
      : this.connection.orm.select({ value: count() }).from(alertEvents).get();
    const total = Number(totalRow?.value ?? 0);

    const rowFilters = [...baseFilters];
    if (query.cursor) {
      rowFilters.push(
        or(
          lt(alertEvents.triggeredAt, query.cursor.triggeredAt),
          and(
            eq(alertEvents.triggeredAt, query.cursor.triggeredAt),
            lt(alertEvents.id, query.cursor.id),
          ),
        )!,
      );
    }

    const rowFilter = rowFilters.length > 0 ? and(...rowFilters) : undefined;
    const rows = rowFilter
      ? this.connection.orm
          .select()
          .from(alertEvents)
          .where(rowFilter)
          .orderBy(desc(alertEvents.triggeredAt), desc(alertEvents.id))
          .limit(limit + 1)
          .all()
      : this.connection.orm
          .select()
          .from(alertEvents)
          .orderBy(desc(alertEvents.triggeredAt), desc(alertEvents.id))
          .limit(limit + 1)
          .all();

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows.at(-1);

    return {
      rows: pageRows,
      total,
      hasMore,
      nextCursor: lastRow
        ? {
            triggeredAt: lastRow.triggeredAt,
            id: lastRow.id,
          }
        : undefined,
    };
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

  private deletePriceTicksById(ids: number[]): number {
    if (ids.length === 0) {
      return 0;
    }

    let deleted = 0;
    for (let index = 0; index < ids.length; index += 400) {
      const chunk = ids.slice(index, index + 400);
      const result = this.connection.orm.delete(priceTicks).where(inArray(priceTicks.id, chunk)).run();
      deleted += Number(result.changes ?? 0);
    }
    return deleted;
  }

  private hasPriceTicksAtOrBefore(cutoffTimestamp: number): boolean {
    const row = this.connection.orm
      .select({ id: priceTicks.id })
      .from(priceTicks)
      .where(lte(priceTicks.timestamp, cutoffTimestamp))
      .limit(1)
      .get();
    return row !== undefined;
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

function mapArchivedPriceTick(row: PriceTick) {
  return {
    id: row.id,
    tokenId: row.tokenId,
    marketId: row.marketId,
    timestamp: row.timestamp,
    lastTradePrice: row.lastTradePrice ?? null,
    bestBid: row.bestBid ?? null,
    bestAsk: row.bestAsk ?? null,
    spread: row.spread ?? null,
  };
}

function normalizeCutoffTimestamp(cutoffTimestamp: number): number {
  if (!Number.isFinite(cutoffTimestamp)) {
    throw new Error('archivePriceTicks requires a finite cutoffTimestamp');
  }
  return Math.floor(cutoffTimestamp);
}

function normalizeBatchSize(batchSize?: number): number {
  if (batchSize === undefined) {
    return 5_000;
  }

  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error('archivePriceTicks batchSize must be a positive finite number');
  }

  return Math.max(1, Math.floor(batchSize));
}

function normalizeRetentionDays(retentionDays: number): number {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return DEFAULT_TICK_RETENTION_DAYS;
  }

  return Math.max(1, Math.floor(retentionDays));
}
