import type {
  AlertEvent,
  AlertRule,
  AppHealth,
  AppSettings,
  DashboardQuery,
  DashboardSnapshot,
  DashboardTickPayload,
  MarketQuery,
  MarketQueryResult,
  MarketRow,
  PreviewSoundPayload,
  RegisterSoundPayload,
  RulePreviewResult,
  SettingsPayload,
  SoundProfile,
} from '@/renderer/types/contracts';
import type {
  AppControlRequest,
  AppControlState,
  StartupStatus,
} from '@/shared/contracts';

export const INVOKE_CHANNELS = [
  'app.getHealth',
  'app.getControlState',
  'app.control',
  'dashboard.query',
  'markets.query',
  'alerts.list',
  'alerts.ack',
  'rules.list',
  'rules.preview',
  'rules.save',
  'settings.get',
  'settings.update',
  'settings.importCityMap',
  'settings.pickSound',
  'settings.registerSound',
  'settings.previewSound',
] as const;

export const EVENT_CHANNELS = [
  'app.health',
  'app.controlState',
  'dashboard.tick',
  'markets.tick',
  'alerts.new',
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];
export type EventChannel = (typeof EVENT_CHANNELS)[number];
export type AlertTriggeredEvent = AlertEvent;

export interface AlertsAckInput {
  id?: string;
  ids?: string[];
}

export interface CityMapImportPayload {
  filePath?: string;
  lines?: string[];
}

export interface PickSoundPayload {
  id?: string;
}

export type RegisterSoundInput = RegisterSoundPayload | undefined;
export type PreviewSoundInput = PreviewSoundPayload | undefined;

export interface RuntimeHealth extends AppHealth {
  reason?: string | null;
}

export interface AppControlErrorPayload {
  code: 'STARTUP_TIMEOUT' | 'STARTUP_FAILED' | 'UNSUPPORTED_ACTION' | 'CONTROL_ERROR';
  message: string;
  retriable: boolean;
}

export type AppControlResult =
  | ({ ok: true } & AppControlState)
  | ({ ok: false; error: AppControlErrorPayload } & AppControlState);

export interface InvokePayloadMap {
  'app.getHealth': undefined;
  'app.getControlState': undefined;
  'app.control': AppControlRequest;
  'dashboard.query': DashboardQuery | undefined;
  'markets.query': MarketQuery | undefined;
  'alerts.list': { limit?: number; acknowledged?: boolean } | undefined;
  'alerts.ack': AlertsAckInput;
  'rules.list': undefined;
  'rules.preview': AlertRule;
  'rules.save': AlertRule[] | { rules: AlertRule[] };
  'settings.get': undefined;
  'settings.update': Partial<AppSettings>;
  'settings.importCityMap': CityMapImportPayload;
  'settings.pickSound': PickSoundPayload | undefined;
  'settings.registerSound': RegisterSoundInput;
  'settings.previewSound': PreviewSoundInput;
}

export interface InvokeResultMap {
  'app.getHealth': RuntimeHealth;
  'app.getControlState': AppControlState;
  'app.control': AppControlResult;
  'dashboard.query': DashboardSnapshot;
  'markets.query': MarketQueryResult;
  'alerts.list': { rows: AlertEvent[]; total: number };
  'alerts.ack': { ok: true; updated: number };
  'rules.list': { rows: AlertRule[] };
  'rules.preview': RulePreviewResult;
  'rules.save': { rows: AlertRule[] };
  'settings.get': SettingsPayload;
  'settings.update': SettingsPayload;
  'settings.importCityMap': { ok: true; imported: number };
  'settings.pickSound': SettingsPayload;
  'settings.registerSound': SettingsPayload;
  'settings.previewSound': { ok: true; played: boolean };
}

export interface EventPayloadMap {
  'app.health': RuntimeHealth;
  'app.controlState': AppControlState;
  'dashboard.tick': DashboardTickPayload;
  'markets.tick': MarketRow[] | MarketQueryResult;
  'alerts.new': AlertEvent;
}

export interface PreloadApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    payload?: InvokePayloadMap[C],
  ): Promise<InvokeResultMap[C]>;
  on<C extends EventChannel>(
    channel: C,
    listener: (payload: EventPayloadMap[C]) => void,
  ): (() => void) | void;
  off?<C extends EventChannel>(
    channel: C,
    listener: (payload: EventPayloadMap[C]) => void,
  ): void;
}

export interface RuntimeState {
  health: RuntimeHealth;
  controlState: AppControlState;
  settingsPayload: SettingsPayload;
}

export const DEFAULT_SETTINGS: AppSettings = {
  startOnBoot: false,
  backgroundAudio: true,
  reconnectPolicy: 'balanced',
  pollIntervalSec: 60,
  selectedSoundProfileId: '',
  quietHoursStart: '23:00',
  quietHoursEnd: '06:00',
};

export const EMPTY_SETTINGS_PAYLOAD: SettingsPayload = {
  settings: DEFAULT_SETTINGS,
  soundProfiles: [],
};

export const DEFAULT_STARTUP_STATUS: StartupStatus = {
  phase: 'idle',
  attempts: 0,
  maxAttempts: 0,
  startedAt: null,
  updatedAt: new Date(0).toISOString(),
  healthReason: 'not-started',
  lastError: null,
};

export const DEFAULT_CONTROL_STATE: AppControlState = {
  notificationsEnabled: true,
  coreProcessRunning: false,
  startupStatus: { ...DEFAULT_STARTUP_STATUS },
};

export const DEFAULT_HEALTH: RuntimeHealth = {
  connected: false,
  mode: 'degraded',
  shardActive: 0,
  shardTotal: 0,
  subscribedTokens: 0,
  reconnects: 0,
  latencyMs: 0,
  droppedEvents: 0,
  lastSyncAt: new Date(0).toISOString(),
  reason: 'not-started',
  workerRunning: false,
  startupPhase: 'stopped',
  diagnostic: null,
  errorSource: 'startup',
  serviceStatus: {
    coreWorker: 'stopped',
    discovery: 'idle',
    websocket: 'disconnected',
    dataFreshness: 'unknown',
    activeShards: 0,
    totalShards: 0,
    lagMs: 0,
    lastUpdateAt: new Date(0).toISOString(),
    lastError: null,
    lastErrorSource: 'startup',
  },
};

export type {
  AlertEvent,
  AlertRule,
  AppControlState,
  AppHealth,
  AppSettings,
  DashboardQuery,
  DashboardSnapshot,
  DashboardTickPayload,
  MarketQuery,
  MarketQueryResult,
  MarketRow,
  SettingsPayload,
  SoundProfile,
};
