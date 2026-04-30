import type {
  AlertMarketSnapshot,
  AlertMessageKey,
  AlertMessageParams,
  BuiltinRuleKey,
} from './alert-display';

export type FeedMode = 'live' | 'mock' | 'degraded';
export type Severity = 'info' | 'warning' | 'critical';
export type OrderSide = 'YES' | 'NO' | 'BOTH';
export type OrderbookLiquiditySide = 'buy' | 'sell' | 'both';
export type LotteryConfirmationSource = 'trade_confirmed' | 'edge_volume' | 'book_depth';
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
  | 'connecting'
  | 'discovering'
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

export interface RuntimeMemoryProcessInfo {
  privateKb: number;
  residentSetKb: number | null;
  sharedKb: number;
}

export interface RuntimeMemoryWorkingSetInfo {
  workingSetKb: number;
  peakWorkingSetKb: number;
  privateBytesKb: number | null;
}

export interface RuntimeBlinkMemoryInfo {
  allocatedKb: number;
  totalKb: number;
}

export interface RuntimeBrowserMemoryTelemetry {
  sampledAt: string;
  pid: number;
  creationTime: number | null;
  cpuPercent: number | null;
  processMemory: RuntimeMemoryProcessInfo | null;
  appMetrics: RuntimeMemoryWorkingSetInfo | null;
}

export interface RuntimeTabMemoryTelemetry {
  sampledAt: string;
  pid: number;
  name: string | null;
  serviceName: string | null;
  creationTime: number;
  cpuPercent: number;
  sandboxed: boolean | null;
  integrityLevel: string | null;
  memory: RuntimeMemoryWorkingSetInfo;
}

export interface RuntimeRendererMemoryTelemetry {
  sampledAt: string;
  pid: number;
  webContentsId: number | null;
  browserWindowId: number | null;
  url: string | null;
  title: string | null;
  hidden: boolean;
  visibilityState: string;
  processMemory: RuntimeMemoryProcessInfo | null;
  blinkMemory: RuntimeBlinkMemoryInfo | null;
  appMetrics: RuntimeMemoryWorkingSetInfo | null;
  cpuPercent: number | null;
  creationTime: number | null;
}

export interface RuntimeMemoryTelemetry {
  sampledAt: string;
  browser: RuntimeBrowserMemoryTelemetry | null;
  tabs: RuntimeTabMemoryTelemetry[];
  renderer: RuntimeRendererMemoryTelemetry | null;
}

export interface RuntimeRendererMemoryReport {
  sampledAt: string;
  pid: number;
  hidden: boolean;
  visibilityState: string;
  processMemory: RuntimeMemoryProcessInfo | null;
  blinkMemory: RuntimeBlinkMemoryInfo | null;
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
  memoryTelemetry?: RuntimeMemoryTelemetry;
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
  lotteryCandidate?: boolean;
  lotteryReferenceAsk?: number | null;
  lotteryCurrentAsk?: number | null;
  lotteryLift?: number | null;
  lotteryConfirmationSource?: LotteryConfirmationSource | null;
  lotteryEffectiveSize?: number | null;
  lotteryEffectiveNotional?: number | null;
  lotteryUpdatedAt?: string | null;
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

export type AlertSource =
  | 'realtime'
  | 'startup-scan'
  | 'rules-save-scan'
  | 'discovery-seed'
  | 'snapshot-backfill'
  | 'system';

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
  source?: AlertSource;
}

export interface AlertListCursor {
  triggeredAt: string;
  id: string;
}

export interface AlertListQuery {
  limit?: number;
  acknowledged?: boolean;
  cursor?: AlertListCursor;
}

export interface AlertListResult {
  rows: AlertEvent[];
  total: number;
  hasMore: boolean;
  nextCursor?: AlertListCursor;
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
    | 'volume_pricing'
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
  liquiditySide?: OrderbookLiquiditySide;
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
  tickRetentionDays: number;
  alertRetentionDays: number;
  selectedSoundProfileId: string;
  quietHoursStart: string;
  quietHoursEnd: string;
}

export interface RuntimeStorageSummary {
  dataRootDir: string;
  mainDbPath: string;
  archiveDir: string;
  backupDir: string;
  sessionDataDir: string;
  logsDir: string;
  mainDbExists: boolean;
  mainDbSizeBytes: number;
  totalSizeBytes: number;
  databaseSizeBytes: number;
  archiveSizeBytes: number;
  backupSizeBytes: number;
  sessionDataSizeBytes: number;
  logsSizeBytes: number;
  cleanableSizeBytes: number;
  cleanableEntryCount?: number;
  sessionPersistentSizeBytes?: number;
  archiveFileCount?: number;
  backupFileCount?: number;
  logFileCount?: number;
  latestLogAt?: string | null;
  canClearCache: boolean;
  lastCleanupAt: string | null;
  priceTickCount: number;
  alertEventCount: number;
  latestPriceTickAt: string | null;
  latestAlertAt: string | null;
  lastActivityAt: string | null;
  latestMainBackupPath: string | null;
  latestMainBackupAt: string | null;
  // Backward-compatible aliases for existing callers that still read the generic name.
  latestBackupPath: string | null;
  latestBackupAt: string | null;
}

export type StorageMaintenanceStatus = 'idle' | 'running' | 'success' | 'error';

export type StorageMaintenanceReason =
  | 'startup'
  | 'scheduled'
  | 'settings-update'
  | 'manual'
  | null;

export interface StorageMaintenanceSummary {
  status: StorageMaintenanceStatus;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastDurationMs: number | null;
  lastArchivedRows: number;
  lastPrunedTickRows: number;
  lastPrunedAlertRows: number;
  lastCheckpointAt: string | null;
  lastCompactionAt: string | null;
  lastReason: StorageMaintenanceReason;
  lastError: string | null;
}

export interface StorageMaintenanceResult {
  summary: StorageMaintenanceSummary;
  storageSummary?: RuntimeStorageSummary;
}

export interface StorageBackupResult {
  backupPath: string;
  storageSummary: RuntimeStorageSummary;
}

export interface StorageCleanupResult {
  reclaimedBytes: number;
  deletedEntries: string[];
  storageSummary: RuntimeStorageSummary;
}

export interface RuntimeDiagnosticsLogFile {
  path: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAt: string | null;
  tail: string;
  tailBytes: number;
  truncated: boolean;
}

export interface RuntimeDiagnosticsPackage {
  version: 1;
  generatedAt: string;
  runtimePaths: {
    dataRootDir: string;
    dbDir: string;
    mainDbPath: string;
    archiveDir: string;
    backupDir: string;
    sessionDataDir: string;
    logsDir: string;
  };
  storageSummary: RuntimeStorageSummary;
  process: {
    pid: number;
    platform: NodeJS.Platform;
    arch: string;
    nodeVersion: string;
    electronVersion: string | null;
  };
  memoryTelemetry?: RuntimeMemoryTelemetry;
  logs: {
    directory: string;
    fileCount: number;
    includedFileCount: number;
    tailBytes: number;
    files: RuntimeDiagnosticsLogFile[];
  };
  privacy: {
    format: 'json';
    excludes: string[];
  };
}

export interface RuntimeDiagnosticsPackageResult {
  packagePath: string;
  diagnostics: RuntimeDiagnosticsPackage;
}

export interface MarketQuery {
  // Accepts exact city keys as well as city/airport/name search text for Market Explorer.
  cityKey?: string;
  eventDate?: string;
  side?: OrderSide;
  watchlistedOnly?: boolean;
  lotteryOnly?: boolean;
  limit?: number;
  sortBy?: 'volume24h' | 'change5m' | 'spread' | 'updatedAt' | 'lotteryLift';
  sortDir?: 'asc' | 'desc';
}

export interface MarketQueryResult {
  rows: MarketRow[];
  total: number;
}

export interface SettingsPayload {
  settings: AppSettings;
  soundProfiles: SoundProfile[];
  storageSummary?: RuntimeStorageSummary;
  storageMaintenance?: StorageMaintenanceSummary;
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

export interface PreviewSoundResult {
  ok?: true;
  played: boolean;
  fallback?: 'system-beep';
}
