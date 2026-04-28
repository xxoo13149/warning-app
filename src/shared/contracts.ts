import type {
  AlertEvent,
  AlertListQuery,
  AlertListResult,
  AlertRule,
  AppHealth,
  AppSettings,
  MarketQuery,
  MarketQueryResult,
  PreviewSoundResult,
  PreviewSoundPayload,
  RegisterSoundPayload,
  RulePreviewResult,
  SettingsPayload,
  StorageMaintenanceResult,
} from './monitor-contracts';

export type Severity = AlertEvent['severity'];
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

export interface AppControlRequest {
  action: AppControlAction;
}

export interface AppControlState {
  notificationsEnabled: boolean;
  coreProcessRunning: boolean;
  startupStatus: StartupStatus;
}

export interface CityConfig {
  cityKey: string;
  displayName: string;
  seriesSlug: string;
  airportCode: string | null;
  timezone: string | null;
  enabled: boolean;
  resolutionSourceOverride?: string | null;
}

export type SettingsUpdatePayload = Partial<AppSettings>;

export interface WorkerRequestMap {
  'app.getHealth': undefined;
  'markets.query': MarketQuery | undefined;
  'alerts.list': AlertListQuery | undefined;
  'alerts.ack': { id?: string; ids?: string[] };
  'rules.list': undefined;
  'rules.preview': AlertRule;
  'rules.save': AlertRule[] | { rules: AlertRule[] };
  'storage.runMaintenance': undefined;
  'settings.get': undefined;
  'settings.update': SettingsUpdatePayload;
  'settings.importCityMap': { filePath?: string; lines?: string[] };
  'settings.pickSound': { id?: string } | undefined;
  'settings.registerSound': RegisterSoundPayload | undefined;
  'settings.previewSound': PreviewSoundPayload | undefined;
}

export interface WorkerResponseMap {
  'app.getHealth': AppHealth;
  'markets.query': MarketQueryResult;
  'alerts.list': AlertListResult;
  'alerts.ack': { ok?: true; updated: number };
  'rules.list': { rows: AlertRule[] };
  'rules.preview': RulePreviewResult;
  'rules.save': { rows: AlertRule[] };
  'storage.runMaintenance': StorageMaintenanceResult;
  'settings.get': SettingsPayload;
  'settings.update': SettingsPayload;
  'settings.importCityMap': { ok?: true; imported: number };
  'settings.pickSound': SettingsPayload;
  'settings.registerSound': SettingsPayload;
  'settings.previewSound': PreviewSoundResult;
}

export type { PreviewSoundResult };
