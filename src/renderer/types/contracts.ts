import type {
  AlertMessageKey,
  AlertMessageParams,
  AlertMarketSnapshot,
  BuiltinRuleKey,
} from '@/shared/alert-display';

export type WorkspaceId = 'dashboard' | 'explorer' | 'alerts' | 'rules';

export type FeedMode = 'live' | 'mock' | 'degraded';
export type Severity = 'info' | 'warning' | 'critical';
export type OrderSide = 'YES' | 'NO' | 'BOTH';
export type AppLanguage = 'zh-CN' | 'en-US';
export type DashboardScope = 'risk' | 'watchlist' | 'alerts';
export type HealthErrorSource =
  | 'worker'
  | 'discovery'
  | 'ws'
  | 'db'
  | 'packaging'
  | 'network'
  | 'startup'
  | 'unknown';
export type AppControlAction =
  | 'enableNotifications'
  | 'disableNotifications'
  | 'startMonitor'
  | 'stopMonitor'
  | 'quitApp';

export type StartupPhase =
  | 'idle'
  | 'starting'
  | 'retrying'
  | 'ready'
  | 'failed'
  | 'stopped';

export interface StartupStatus {
  phase: StartupPhase;
  attempts: number;
  maxAttempts: number;
  startedAt: string | null;
  updatedAt: string;
  healthReason: string | null;
  lastError: string | null;
}

export interface ServiceStatusSnapshot {
  coreWorker: 'running' | 'stopped' | 'error';
  discovery: 'idle' | 'discovering' | 'ready' | 'empty' | 'error';
  websocket: 'disconnected' | 'connecting' | 'partial' | 'connected';
  dataFreshness: 'unknown' | 'realtime' | 'delayed' | 'stale';
  activeShards: number;
  totalShards: number;
  lagMs: number;
  lastUpdateAt: string;
  lastError?: string | null;
  lastErrorSource?: HealthErrorSource | null;
}

export interface AppHealth {
  connected: boolean;
  mode: FeedMode;
  shardActive: number;
  shardTotal: number;
  subscribedTokens: number;
  reconnects: number;
  latencyMs: number;
  droppedEvents: number;
  lastSyncAt: string;
  workerRunning?: boolean;
  startupPhase?: 'stopped' | 'starting' | 'running' | 'degraded';
  diagnostic?: string | null;
  errorSource?: HealthErrorSource | null;
  serviceStatus?: ServiceStatusSnapshot;
}

export interface AppControlState {
  notificationsEnabled: boolean;
  coreProcessRunning: boolean;
  startupStatus?: StartupStatus;
}

export type RuntimeActionKind =
  | 'idle'
  | 'notifications'
  | 'starting'
  | 'stopping'
  | 'quitting'
  | 'done'
  | 'error';

export interface RuntimeActionFeedback {
  kind: RuntimeActionKind;
  busy: boolean;
  progress: number;
  message: string;
  error: string | null;
}

export interface MarketRow {
  marketId: string;
  cityKey: string;
  cityName: string;
  airportCode: string;
  eventDate: string;
  temperatureBand: string;
  side: OrderSide;
  yesPrice: number | null;
  noPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  change5m: number;
  volume24h: number;
  status: 'active' | 'halted' | 'resolved';
  bubbleScore: number;
  bubbleSeverity: 'none' | 'info' | 'warning' | 'critical';
  bubbleUpdatedAt: string;
  updatedAt: string;
  watchlisted: boolean;
}

export interface CityBubbleMarketPreview {
  marketId: string;
  temperatureBand: string;
  yesPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  change5m: number;
  bubbleScore: number;
  bubbleSeverity: 'none' | 'info' | 'warning' | 'critical';
  updatedAt: string;
}

export interface CityBubbleSummary {
  cityKey: string;
  cityName: string;
  airportCode?: string | null;
  eventDate: string;
  marketCount: number;
  watchlisted: boolean;
  unackedAlertCount: number;
  cityBubbleScore: number;
  cityBubbleSeverity: 'none' | 'info' | 'warning' | 'critical';
  dominantMarketId: string;
  dominantTemperatureBand: string;
  dominantYesPrice: number | null;
  dominantRuleName?: string | null;
  updatedAt: string;
  topMarkets: CityBubbleMarketPreview[];
}

export interface DashboardQuery {
  eventDate?: string;
  scope?: DashboardScope;
}

export interface DashboardSnapshot {
  rows: CityBubbleSummary[];
  coveredMarketCount: number;
  visibleCityCount: number;
  totalCityCount: number;
  hiddenCityCount: number;
  selectedDate: string;
  scope: DashboardScope;
  availableDates: string[];
  updatedAt: string;
}

export interface DashboardTickPayload {
  updatedAt: string;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  builtinKey?: BuiltinRuleKey;
  triggeredAt: string;
  cityKey: string;
  marketId: string;
  tokenId: string;
  message: string;
  messageKey?: AlertMessageKey;
  messageParams?: AlertMessageParams;
  marketSnapshot?: AlertMarketSnapshot;
  severity: Severity;
  acknowledged: boolean;
  soundProfileId?: string;
}

export interface AlertRule {
  id: string;
  name: string;
  isBuiltin?: boolean;
  builtinKey?: BuiltinRuleKey;
  metric:
    | 'price'
    | 'change5m'
    | 'spread'
    | 'liquidity_kill'
    | 'bidask_gap'
    | 'new_market'
    | 'resolved'
    | 'feed_stale';
  operator: '>' | '<' | '>=' | '<=' | 'crosses';
  threshold: number;
  windowSec: number;
  cooldownSec: number;
  dedupeWindowSec: number;
  bubbleWeight: number;
  severity: Severity;
  enabled: boolean;
  soundProfileId: string;
  scope: {
    cityKey?: string;
    seriesSlug?: string;
    eventDate?: string;
    temperatureBand?: string;
    marketId?: string;
    tokenId?: string;
    side?: OrderSide;
  };
  quietHours?: {
    startMinute: number;
    endMinute: number;
  };
}

export interface SoundProfile {
  id: string;
  name: string;
  filePath: string;
  gain: number;
  enabled: boolean;
  isBuiltin: boolean;
  isDefault: boolean;
}

export interface AppSettings {
  startOnBoot: boolean;
  backgroundAudio: boolean;
  reconnectPolicy: 'aggressive' | 'balanced' | 'conservative';
  pollIntervalSec: number;
  selectedSoundProfileId: string;
  quietHoursStart: string;
  quietHoursEnd: string;
}

export interface MarketQuery {
  cityKey?: string;
  eventDate?: string;
  side?: OrderSide;
  watchlistedOnly?: boolean;
  limit?: number;
  sortBy?: 'volume24h' | 'change5m' | 'spread' | 'updatedAt';
  sortDir?: 'asc' | 'desc';
}

export interface MarketQueryResult {
  rows: MarketRow[];
  total: number;
}

export interface SettingsPayload {
  settings: AppSettings;
  soundProfiles: SoundProfile[];
}

export interface RulePreviewMarketSample {
  marketId: string;
  cityKey: string;
  cityName: string;
  eventDate: string;
  temperatureBand: string;
  side: OrderSide;
  yesPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  updatedAt: string;
}

export interface RulePreviewResult {
  matchedCityCount: number;
  matchedMarketCount: number;
  sampleMarkets: RulePreviewMarketSample[];
}

export interface RegisterSoundPayload {
  id?: string;
  filePath?: string;
  name?: string;
  gain?: number;
  enabled?: boolean;
  setAsDefault?: boolean;
  isBuiltin?: boolean;
}

export interface PreviewSoundPayload {
  id?: string;
  filePath?: string;
  gain?: number;
}
