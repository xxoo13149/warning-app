import { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const cityConfig = sqliteTable(
  'city_config',
  {
    cityKey: text('city_key').primaryKey(),
    displayName: text('display_name').notNull(),
    seriesSlug: text('series_slug').notNull().unique(),
    airportCode: text('airport_code').notNull(),
    timezone: text('timezone').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    resolutionSourceOverride: text('resolution_source_override'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    seriesSlugIdx: index('city_config_series_slug_idx').on(table.seriesSlug),
  }),
);

export const trackedEvents = sqliteTable(
  'tracked_events',
  {
    eventId: text('event_id').primaryKey(),
    cityKey: text('city_key').notNull(),
    seriesSlug: text('series_slug').notNull(),
    eventDate: text('event_date').notNull(),
    title: text('title').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    closed: integer('closed', { mode: 'boolean' }).notNull().default(false),
    endDate: text('end_date'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    cityDateIdx: index('tracked_events_city_date_idx').on(table.cityKey, table.eventDate),
    seriesSlugIdx: index('tracked_events_series_slug_idx').on(table.seriesSlug),
  }),
);

export const trackedMarkets = sqliteTable(
  'tracked_markets',
  {
    marketId: text('market_id').primaryKey(),
    eventId: text('event_id').notNull(),
    cityKey: text('city_key').notNull(),
    seriesSlug: text('series_slug').notNull(),
    eventDate: text('event_date').notNull(),
    conditionId: text('condition_id').notNull(),
    groupItemTitle: text('group_item_title').notNull(),
    tokenYesId: text('token_yes_id').notNull(),
    tokenNoId: text('token_no_id').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    closed: integer('closed', { mode: 'boolean' }).notNull().default(false),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    eventIdx: index('tracked_markets_event_idx').on(table.eventId),
    cityDateIdx: index('tracked_markets_city_date_idx').on(table.cityKey, table.eventDate),
    tokenYesIdx: index('tracked_markets_token_yes_idx').on(table.tokenYesId),
    tokenNoIdx: index('tracked_markets_token_no_idx').on(table.tokenNoId),
  }),
);

export const latestTokenState = sqliteTable(
  'latest_token_state',
  {
    tokenId: text('token_id').primaryKey(),
    marketId: text('market_id').notNull(),
    side: text('side').$type<'yes' | 'no'>().notNull(),
    lastTradePrice: real('last_trade_price'),
    bestBid: real('best_bid'),
    bestAsk: real('best_ask'),
    spread: real('spread'),
    lastMessageAt: integer('last_message_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    marketIdx: index('latest_token_state_market_idx').on(table.marketId),
  }),
);

export const priceTicks = sqliteTable(
  'price_ticks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tokenId: text('token_id').notNull(),
    marketId: text('market_id').notNull(),
    timestamp: integer('timestamp').notNull(),
    lastTradePrice: real('last_trade_price'),
    bestBid: real('best_bid'),
    bestAsk: real('best_ask'),
    spread: real('spread'),
  },
  (table) => ({
    tokenTimeIdx: index('price_ticks_token_time_idx').on(table.tokenId, table.timestamp),
    marketTimeIdx: index('price_ticks_market_time_idx').on(table.marketId, table.timestamp),
  }),
);

export const alertRules = sqliteTable(
  'alert_rules',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
    builtinKey: text('builtin_key'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    metric: text('metric').notNull(),
    operator: text('operator').notNull(),
    threshold: real('threshold').notNull(),
    windowSec: integer('window_sec').notNull().default(60),
    cooldownSec: integer('cooldown_sec').notNull().default(300),
    dedupeWindowSec: integer('dedupe_window_sec').notNull().default(60),
    bubbleWeight: real('bubble_weight').notNull().default(60),
    severity: text('severity').notNull(),
    soundProfileId: text('sound_profile_id'),
    liquiditySide: text('liquidity_side'),
    scopeCityKey: text('scope_city_key'),
    scopeSeriesSlug: text('scope_series_slug'),
    scopeEventDate: text('scope_event_date'),
    scopeTemperatureBand: text('scope_temperature_band'),
    scopeMarketId: text('scope_market_id'),
    scopeTokenId: text('scope_token_id'),
    scopeSide: text('scope_side'),
    quietStartMinute: integer('quiet_start_minute'),
    quietEndMinute: integer('quiet_end_minute'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    enabledIdx: index('alert_rules_enabled_idx').on(table.enabled),
  }),
);

export const alertEvents = sqliteTable(
  'alert_events',
  {
    id: text('id').primaryKey(),
    ruleId: text('rule_id').notNull(),
    builtinKey: text('builtin_key'),
    triggeredAt: integer('triggered_at').notNull(),
    cityKey: text('city_key'),
    eventId: text('event_id'),
    marketId: text('market_id'),
    tokenId: text('token_id'),
    message: text('message').notNull(),
    messageKey: text('message_key'),
    messageParams: text('message_params'),
    marketSnapshot: text('market_snapshot'),
    severity: text('severity').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    acknowledged: integer('acknowledged', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => ({
    ruleTimeIdx: index('alert_events_rule_time_idx').on(table.ruleId, table.triggeredAt),
    ackIdx: index('alert_events_ack_idx').on(table.acknowledged),
  }),
);

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const soundProfiles = sqliteTable(
  'sound_profiles',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    filePath: text('file_path').notNull(),
    volume: real('volume').notNull().default(1),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    defaultIdx: index('sound_profiles_default_idx').on(table.isDefault),
  }),
);

export const feedHealth = sqliteTable('feed_health', {
  feedKey: text('feed_key').primaryKey(),
  status: text('status').notNull(),
  lastOkAt: integer('last_ok_at'),
  lastMessageAt: integer('last_message_at').notNull(),
  lastError: text('last_error'),
  reconnectCount: integer('reconnect_count').notNull().default(0),
  latencyMs: integer('latency_ms'),
  updatedAt: integer('updated_at').notNull(),
});

export type CityConfig = InferSelectModel<typeof cityConfig>;
export type NewCityConfig = InferInsertModel<typeof cityConfig>;

export type TrackedEvent = InferSelectModel<typeof trackedEvents>;
export type NewTrackedEvent = InferInsertModel<typeof trackedEvents>;

export type TrackedMarket = InferSelectModel<typeof trackedMarkets>;
export type NewTrackedMarket = InferInsertModel<typeof trackedMarkets>;

export type LatestTokenState = InferSelectModel<typeof latestTokenState>;
export type NewLatestTokenState = InferInsertModel<typeof latestTokenState>;

export type PriceTick = InferSelectModel<typeof priceTicks>;
export type NewPriceTick = InferInsertModel<typeof priceTicks>;

export type AlertRuleRow = InferSelectModel<typeof alertRules>;
export type NewAlertRuleRow = InferInsertModel<typeof alertRules>;

export type AlertEventRow = InferSelectModel<typeof alertEvents>;
export type NewAlertEventRow = InferInsertModel<typeof alertEvents>;

export type AppSetting = InferSelectModel<typeof appSettings>;
export type NewAppSetting = InferInsertModel<typeof appSettings>;

export type SoundProfile = InferSelectModel<typeof soundProfiles>;
export type NewSoundProfile = InferInsertModel<typeof soundProfiles>;

export type FeedHealthRow = InferSelectModel<typeof feedHealth>;
export type NewFeedHealthRow = InferInsertModel<typeof feedHealth>;
