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
    settingsGet: 'settings.get',
    settingsUpdate: 'settings.update',
    settingsImportCityMap: 'settings.importCityMap',
    settingsPickSound: 'settings.pickSound',
    settingsRegisterSound: 'settings.registerSound',
    settingsPreviewSound: 'settings.previewSound',
  },
  events: {
    health: 'app.health',
    controlState: 'app.controlState',
    dashboardTick: 'dashboard.tick',
    marketsTick: 'markets.tick',
    alertsNew: 'alerts.new',
  },
} as const;

export const APP_NAME = '天气预警台';
export const DEFAULT_FEED_REFRESH_MS = 60_000;
export const DEFAULT_SOCKET_TOKEN_BATCH = 300;
export const DEFAULT_TICK_RETENTION_DAYS = 7;
