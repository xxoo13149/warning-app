export type Side = 'BUY' | 'SELL';

export interface CityConfig {
  cityKey: string;
  displayName: string;
  seriesSlug: string;
  airportCode: string;
  timezone: string;
  enabled: boolean;
  resolutionSourceOverride?: string;
}

export interface GammaTag {
  id: number;
  label?: string;
  slug?: string;
  [key: string]: unknown;
}

export interface GammaMarket {
  id: string;
  conditionId?: string;
  question?: string;
  groupItemTitle?: string;
  outcomes?: unknown;
  clobTokenIds?: unknown;
  active?: boolean;
  closed?: boolean;
  [key: string]: unknown;
}

export interface GammaEvent {
  id: string;
  slug?: string;
  title?: string;
  seriesSlug?: string;
  startDate?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  markets?: GammaMarket[];
  [key: string]: unknown;
}

export interface NormalizedMarket {
  seriesSlug: string;
  eventId: string;
  eventDate: string;
  marketId: string;
  conditionId?: string;
  groupItemTitle?: string;
  question?: string;
  active: boolean;
  closed: boolean;
  tokenIds: string[];
  yesTokenId?: string;
  noTokenId?: string;
  outcomes: string[];
  cityKey?: string;
  priceSeed?: NormalizedMarketPriceSeed;
}

export interface MarketPriceSeed {
  lastTradePrice?: number;
  bestBid?: number;
  bestAsk?: number;
}

export interface NormalizedMarketPriceSeed {
  yes?: MarketPriceSeed;
  no?: MarketPriceSeed;
}

export interface NormalizedEvent {
  eventId: string;
  seriesSlug: string;
  cityKey?: string;
  title?: string;
  eventDate: string;
  active: boolean;
  closed: boolean;
  markets: NormalizedMarket[];
}

export interface DailyWeatherUniverse {
  discoveredAt: string;
  weatherTagId: number | null;
  events: NormalizedEvent[];
  markets: NormalizedMarket[];
  tokenIds: string[];
  eventCount: number;
  marketCount: number;
  tokenCount: number;
}

export interface GammaDiscoveryOptions {
  gammaBaseUrl?: string;
  weatherTagSlug?: string;
  weatherTagId?: number;
  dailyWeatherSeriesSuffix?: string;
  pageSize?: number;
  fetchTimeoutMs?: number;
  proxyUrl?: string;
}

export interface GammaDiscoverInput {
  cityConfigs?: CityConfig[];
  includeDisabledCities?: boolean;
  active?: boolean;
  closed?: boolean;
}

export interface ClobRestClientOptions {
  clobBaseUrl?: string;
  fetchTimeoutMs?: number;
  maxBatchSize?: number;
  proxyUrl?: string;
}

export interface PriceRequest {
  token_id: string;
  side: Side;
}

export interface PriceResponseItem {
  token_id: string;
  side: Side;
  price: string;
}

export interface PriceSnapshot {
  tokenId: string;
  buyPrice?: number;
  sellPrice?: number;
  updatedAt: number;
}

export interface BookLevel {
  price: string;
  size: string;
}

export interface BookResponseItem {
  market: string;
  asset_id: string;
  hash?: string;
  bids?: BookLevel[];
  asks?: BookLevel[];
  timestamp?: string;
}

export interface MarketWsMessage {
  event_type?: string;
  asset_id?: string;
  market?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export type ShardConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closing'
  | 'closed';

export interface TokenShardState {
  shardId: string;
  tokenIds: string[];
  state: ShardConnectionState;
  reconnectAttempt: number;
  lastMessageAt: number | null;
  connectedAt: number | null;
  reconnectInMs?: number;
}

export interface TokenShardWsManagerOptions {
  marketWsUrl?: string;
  tokensPerShard?: number;
  heartbeatIntervalMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  proxyUrl?: string;
}

export interface ShardMarketEvent {
  shardId: string;
  receivedAt: number;
  event: MarketWsMessage;
}

export interface ShardStatusEvent {
  shardId: string;
  state: ShardConnectionState;
  reason?: string;
  reconnectAttempt: number;
  reconnectInMs?: number;
  tokenCount: number;
  at: number;
}

export interface TokenRuntimeState {
  tokenId: string;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  spread?: number;
  bookBestBid?: number;
  bookBestAsk?: number;
  lastEventType?: string;
  updatedAt: number;
}
