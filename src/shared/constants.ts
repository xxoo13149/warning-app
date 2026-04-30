export const IPC_CHANNELS = {
  invoke: {
    appGetHealth: 'app.getHealth',
    appGetControlState: 'app.getControlState',
    appControl: 'app.control',
    dashboardQuery: 'dashboard.query',
    marketsQuery: 'markets.query',
    alertsList: 'alerts.list',
    alertsAck: 'alerts.ack',
    rulesList: 'rules.list',
    rulesPreview: 'rules.preview',
    rulesSave: 'rules.save',
    storageClearCache: 'storage.clearCache',
    storageCreateBackup: 'storage.createBackup',
    storageCreateDiagnostics: 'storage.createDiagnostics',
    storageRunMaintenance: 'storage.runMaintenance',
    settingsGet: 'settings.get',
    settingsUpdate: 'settings.update',
    settingsImportCityMap: 'settings.importCityMap',
    settingsPickSound: 'settings.pickSound',
    settingsRegisterSound: 'settings.registerSound',
    settingsPreviewSound: 'settings.previewSound',
  },
  internal: {
    telemetryMemoryReport: 'telemetry.memory.report',
  },
  events: {
    health: 'app.health',
    controlState: 'app.controlState',
    navigate: 'app.navigate',
    dashboardTick: 'dashboard.tick',
    marketsTick: 'markets.tick',
    alertsNew: 'alerts.new',
  },
} as const;

export const APP_NAME = '天气监控';
export const APP_USER_MODEL_ID = 'com.polymarket.weather-monitor';
export const DEFAULT_FEED_REFRESH_MS = 60_000;
export const DEFAULT_SOCKET_TOKEN_BATCH = 300;
export const DEFAULT_TICK_RETENTION_DAYS = 7;
export const MIN_TICK_RETENTION_DAYS = 3;
export const MAX_TICK_RETENTION_DAYS = 30;
export const DEFAULT_ALERT_RETENTION_DAYS = 90;
export const MIN_ALERT_RETENTION_DAYS = 30;
export const MAX_ALERT_RETENTION_DAYS = 365;
