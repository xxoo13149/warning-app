import { useCallback, useEffect, useRef, useState } from 'react';
import { bridgeMode, ipcBridge } from '../api/ipcBridge';
import { useI18n } from '../i18n';
import type {
  AppControlState,
  AlertEvent,
  AlertRule,
  AppHealth,
  AppSettings,
  MarketQuery,
  MarketQueryResult,
  MarketRow,
  PreviewSoundPayload,
  RegisterSoundPayload,
  RulePreviewResult,
  RuntimeActionFeedback,
  SettingsPayload,
  SoundProfile,
} from '../types/contracts';
import { useIpcSubscription } from './useIpc';

interface MonitorConsoleState {
  mode: 'live' | 'mock';
  loading: boolean;
  health: AppHealth;
  controlState: AppControlState;
  runtimeAction: RuntimeActionFeedback;
  markets: MarketRow[];
  marketTotal: number;
  marketQuery: MarketQuery;
  alerts: AlertEvent[];
  rules: AlertRule[];
  settings: AppSettings;
  soundProfiles: SoundProfile[];
  setMarketQuery: (query: Partial<MarketQuery>) => void;
  refreshMarkets: () => Promise<void>;
  refreshAll: () => Promise<void>;
  acknowledgeAlert: (id: string) => Promise<void>;
  previewRule: (rule: AlertRule) => Promise<RulePreviewResult>;
  saveRules: (nextRules: AlertRule[]) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  pickSound: (profileId: string) => Promise<void>;
  registerSound: (payload?: RegisterSoundPayload) => Promise<void>;
  previewSound: (payload: PreviewSoundPayload) => Promise<boolean>;
  importCityMap: (lines: string[]) => Promise<void>;
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
  stopMonitor: () => Promise<void>;
  startMonitor: () => Promise<void>;
  quitApp: () => Promise<void>;
}

const defaultHealth: AppHealth = {
  connected: false,
  mode: 'degraded',
  shardActive: 0,
  shardTotal: 0,
  subscribedTokens: 0,
  reconnects: 0,
  latencyMs: 0,
  droppedEvents: 0,
  lastSyncAt: new Date(0).toISOString(),
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

const defaultControlState: AppControlState = {
  notificationsEnabled: true,
  coreProcessRunning: false,
};

const defaultRuntimeAction: RuntimeActionFeedback = {
  kind: 'idle',
  busy: false,
  progress: 0,
  message: '',
  error: null,
};

const defaultSettings: AppSettings = {
  startOnBoot: false,
  backgroundAudio: true,
  reconnectPolicy: 'balanced',
  pollIntervalSec: 60,
  selectedSoundProfileId: '',
  quietHoursStart: '23:00',
  quietHoursEnd: '06:00',
};

const normalizeMarketResult = (payload: unknown): MarketQueryResult => {
  if (!payload) return { rows: [], total: 0 };
  if (Array.isArray(payload)) {
    return { rows: payload as MarketRow[], total: (payload as MarketRow[]).length };
  }
  const shaped = payload as Partial<MarketQueryResult>;
  if (!Array.isArray(shaped.rows)) return { rows: [], total: 0 };
  return {
    rows: shaped.rows,
    total: typeof shaped.total === 'number' ? shaped.total : shaped.rows.length,
  };
};

const normalizeAlertRows = (payload: unknown): AlertEvent[] => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload as AlertEvent[];
  const shaped = payload as { rows?: AlertEvent[] };
  return Array.isArray(shaped.rows) ? shaped.rows : [];
};

const mergeSettingsPayload = (
  payload: unknown,
  previousSettings: AppSettings,
  previousSounds: SoundProfile[],
) => {
  if (!payload) {
    return { settings: previousSettings, soundProfiles: previousSounds };
  }
  const shaped = payload as Partial<SettingsPayload>;
  const settings = shaped.settings ?? previousSettings;
  const soundProfiles = shaped.soundProfiles ?? previousSounds;
  return { settings, soundProfiles };
};

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

const STARTUP_REASON_LABELS_ZH: Record<string, string> = {
  'not-started': '监控尚未启动',
  'feed-not-ready': '数据流尚未就绪',
  discovering: '正在发现市场...',
  'discovery-empty': '当前还没有发现可订阅的盘口',
  'discovery-failed': '市场发现失败',
  connecting: '正在连接实时数据流...',
  'partial-connectivity': '部分分片已连接，剩余分片仍在继续连接',
  'websocket-disconnected': '实时 WebSocket 已断开，正在等待重连',
  'awaiting-websocket': '已发现市场，正在等待 WebSocket 建立连接',
  'awaiting-websocket-shards': '正在准备 WebSocket 分片...',
  'no-active-shards': 'WebSocket 分片暂未连接成功',
  'feed-degraded': '数据流处于降级状态',
  'worker-not-running': '监控进程未运行',
  'core-worker-not-running': '核心监控进程未运行',
  'monitor-stopped-by-user': '监控已手动停止',
  'startup-failed-without-reason': '启动失败，但没有返回明确原因',
};

const STARTUP_REASON_LABELS_CLEAN_ZH: Record<string, string> = {
  'not-started': '监控尚未启动',
  'feed-not-ready': '数据流尚未就绪',
  discovering: '正在发现市场...',
  'discovery-empty': '当前还没有发现可订阅的盘口',
  'discovery-failed': '市场发现失败',
  connecting: '正在连接实时数据流...',
  'partial-connectivity': '部分分片已连接，剩余分片仍在继续连接',
  'websocket-disconnected': '实时 WebSocket 已断开，正在等待重连',
  'awaiting-websocket': '已发现市场，正在等待 WebSocket 建立连接',
  'awaiting-websocket-shards': '正在准备 WebSocket 分片...',
  'no-active-shards': 'WebSocket 分片暂未连接成功',
  'feed-degraded': '数据流处于降级状态',
  'worker-not-running': '监控进程未运行',
  'core-worker-not-running': '核心监控进程未运行',
  'monitor-stopped-by-user': '监控已手动停止',
  'startup-failed-without-reason': '启动失败，但没有返回明确原因',
};

const formatRuntimeReason = (
  reason: string | null | undefined,
  language: 'zh-CN' | 'en-US',
): string | null => {
  const normalized = reason?.trim();
  if (!normalized) {
    return null;
  }
  if (language === 'en-US') {
    return normalized;
  }
  if (normalized.startsWith('STARTUP_TIMEOUT:')) {
    const detail = normalized.slice('STARTUP_TIMEOUT:'.length).trim();
    return `启动超时：${formatRuntimeReason(detail, language) ?? detail}`;
  }
  if (normalized.startsWith('snapshot-refresh-failed:')) {
    const detail = normalized.slice('snapshot-refresh-failed:'.length).trim();
    return `状态刷新失败：${detail || '未知错误'}`;
  }
  if (normalized.startsWith('worker-error:')) {
    const detail = normalized.slice('worker-error:'.length).trim();
    return `监控进程异常：${detail || '未知错误'}`;
  }
  return STARTUP_REASON_LABELS_CLEAN_ZH[normalized] ?? STARTUP_REASON_LABELS_ZH[normalized] ?? normalized;
};

const normalizeHealthForDisplay = (
  health: AppHealth,
  language: 'zh-CN' | 'en-US',
): AppHealth =>
  ({
    ...health,
    diagnostic: formatRuntimeReason(health.diagnostic, language) ?? health.diagnostic,
    reason:
      formatRuntimeReason((health as AppHealth & { reason?: string | null }).reason, language) ??
      (health as AppHealth & { reason?: string | null }).reason,
    serviceStatus: health.serviceStatus
      ? {
          ...health.serviceStatus,
          lastError:
            formatRuntimeReason(health.serviceStatus.lastError, language) ??
            health.serviceStatus.lastError,
        }
      : health.serviceStatus,
  }) as AppHealth;

type AppControlResponse =
  | (AppControlState & { ok?: true })
  | ({ ok: false; error?: { message?: string } } & AppControlState);

const asControlState = (
  payload: AppControlResponse,
  fallbackMessage: string,
): AppControlState => {
  if (!payload) {
    throw new Error(fallbackMessage);
  }
  if ((payload as { ok?: boolean }).ok === false) {
    const message = (payload as { error?: { message?: string } }).error?.message;
    throw new Error(message || fallbackMessage);
  }
  return payload as AppControlState;
};

const TICK_BATCH_WINDOW_MS = 80;
const MAX_PENDING_TICKS = 150;
const START_PROGRESS_MAX = 68;
const START_PROGRESS_INTERVAL_MS = 320;
const MARKET_LIMIT_DEFAULT = 2000;
const MARKET_LIMIT_MIN = 1;

const normalizeMarketLimit = (limit: number | undefined): number => {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return MARKET_LIMIT_DEFAULT;
  }
  const normalized = Math.trunc(limit);
  return Math.max(MARKET_LIMIT_MIN, Math.min(normalized, MARKET_LIMIT_DEFAULT));
};

const normalizeMarketQuery = (query: MarketQuery): MarketQuery => ({
  cityKey: query.cityKey,
  eventDate: query.eventDate,
  side: query.side,
  watchlistedOnly: query.watchlistedOnly,
  limit: normalizeMarketLimit(query.limit),
  sortBy: query.sortBy ?? 'volume24h',
  sortDir: query.sortDir ?? 'desc',
});

const isSameMarketQuery = (left: MarketQuery, right: MarketQuery): boolean =>
  left.cityKey === right.cityKey &&
  left.eventDate === right.eventDate &&
  left.side === right.side &&
  left.watchlistedOnly === right.watchlistedOnly &&
  left.limit === right.limit &&
  left.sortBy === right.sortBy &&
  left.sortDir === right.sortDir;

export const useMonitorConsole = (): MonitorConsoleState => {
  const { copy, language } = useI18n();
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<AppHealth>(defaultHealth);
  const [controlState, setControlState] = useState<AppControlState>(defaultControlState);
  const [runtimeAction, setRuntimeAction] =
    useState<RuntimeActionFeedback>(defaultRuntimeAction);
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [marketTotal, setMarketTotal] = useState(0);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [soundProfiles, setSoundProfiles] = useState<SoundProfile[]>([]);
  const [marketQuery, setMarketQueryState] = useState<MarketQuery>(
    normalizeMarketQuery({
      limit: MARKET_LIMIT_DEFAULT,
      sortBy: 'volume24h',
      sortDir: 'desc',
    }),
  );
  const pendingMarketTicksRef = useRef<Map<string, MarketRow>>(new Map());
  const marketTickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setMarketQuery = useCallback((query: Partial<MarketQuery>) => {
    setMarketQueryState((prev) => {
      const merged = {
        ...prev,
        ...query,
        limit: query.limit === undefined ? prev.limit : query.limit,
      };
      const next = normalizeMarketQuery(merged);
      return isSameMarketQuery(prev, next) ? prev : next;
    });
  }, []);

  const flushPendingMarketTicks = useCallback(() => {
    marketTickTimerRef.current = null;
    const pending = pendingMarketTicksRef.current;
    if (pending.size === 0) {
      return;
    }
    setMarkets((prev) => {
      if (prev.length === 0) {
        pending.clear();
        return prev;
      }

      let changed = false;
      const next = prev.map((row) => {
        const incoming = pending.get(row.marketId);
        if (!incoming) return row;
        changed = true;
        return incoming;
      });
      pending.clear();
      return changed ? next : prev;
    });
  }, []);

  const scheduleMarketTickFlush = useCallback(() => {
    if (marketTickTimerRef.current !== null) return;
    marketTickTimerRef.current = setTimeout(() => {
      flushPendingMarketTicks();
    }, TICK_BATCH_WINDOW_MS);
  }, [flushPendingMarketTicks]);

  const queueMarketTickUpdates = useCallback(
    (updates: MarketRow[]) => {
      if (updates.length === 0) return;

      const pending = pendingMarketTicksRef.current;
      updates.forEach((row) => {
        pending.set(row.marketId, row);
      });

      if (pending.size >= MAX_PENDING_TICKS) {
        if (marketTickTimerRef.current !== null) {
          clearTimeout(marketTickTimerRef.current);
          marketTickTimerRef.current = null;
        }
        flushPendingMarketTicks();
        return;
      }

      scheduleMarketTickFlush();
    },
    [flushPendingMarketTicks, scheduleMarketTickFlush],
  );

  const refreshMarkets = async () => {
    const payload = await ipcBridge.invoke<MarketQueryResult>('markets.query', marketQuery);
    const result = normalizeMarketResult(payload);
    setMarkets(result.rows);
    setMarketTotal(result.total);
  };

  const refreshAll = async () => {
    setLoading(true);
    try {
      const [
        healthPayload,
        controlPayload,
        marketPayload,
        alertPayload,
        settingsPayload,
        rulesPayload,
      ] =
        await Promise.all([
          ipcBridge.invoke<AppHealth>('app.getHealth'),
          ipcBridge.invoke<AppControlState>('app.getControlState'),
          ipcBridge.invoke<MarketQueryResult>('markets.query', marketQuery),
          ipcBridge.invoke<{ rows: AlertEvent[] }>('alerts.list', { limit: 200 }),
          ipcBridge.invoke<SettingsPayload>('settings.get'),
          ipcBridge.invoke<{ rows: AlertRule[] }>('rules.list').catch(() => ({ rows: [] })),
        ]);

      if (healthPayload) {
        setHealth(normalizeHealthForDisplay(healthPayload, language));
      }
      if (controlPayload) {
        setControlState(controlPayload);
      }

      const normalizedMarkets = normalizeMarketResult(marketPayload);
      const normalizedAlerts = normalizeAlertRows(alertPayload).slice(0, 200);
      setMarkets(normalizedMarkets.rows);
      setMarketTotal(normalizedMarkets.total);
      setAlerts(normalizedAlerts);

      const mergedSettings = mergeSettingsPayload(
        settingsPayload,
        settings,
        soundProfiles,
      );
      setSettings(mergedSettings.settings);
      setSoundProfiles(mergedSettings.soundProfiles);

      if (Array.isArray(rulesPayload?.rows)) {
        setRules(rulesPayload.rows);
      }
    } finally {
      setLoading(false);
    }
  };

  const acknowledgeAlert = async (id: string) => {
    await ipcBridge.invoke('alerts.ack', { id });
    setAlerts((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, acknowledged: true } : item,
      ),
    );
  };

  const saveRules = async (nextRules: AlertRule[]) => {
    const payload = await ipcBridge.invoke<{ rows?: AlertRule[] }>('rules.save', nextRules);
    if (Array.isArray(payload?.rows) && payload.rows.length > 0) {
      setRules(payload.rows);
      return;
    }
    setRules(nextRules);
  };

  const updateSettings = async (patch: Partial<AppSettings>) => {
    const payload = await ipcBridge.invoke<SettingsPayload>('settings.update', patch);
    const merged = mergeSettingsPayload(payload, settings, soundProfiles);
    setSettings(merged.settings);
    setSoundProfiles(merged.soundProfiles);
  };

  const pickSound = async (profileId: string) => {
    const payload = await ipcBridge.invoke<SettingsPayload>('settings.pickSound', { id: profileId });
    const merged = mergeSettingsPayload(payload, settings, soundProfiles);
    setSettings(merged.settings);
    setSoundProfiles(merged.soundProfiles);
  };

  const registerSound = async (payload?: RegisterSoundPayload) => {
    const nextPayload = await ipcBridge.invoke<SettingsPayload>('settings.registerSound', payload);
    const merged = mergeSettingsPayload(nextPayload, settings, soundProfiles);
    setSettings(merged.settings);
    setSoundProfiles(merged.soundProfiles);
  };

  const previewSound = async (payload: PreviewSoundPayload) => {
    const response = await ipcBridge.invoke<{ ok?: true; played?: boolean }>(
      'settings.previewSound',
      payload,
    );
    return Boolean(response?.played);
  };

  const previewRule = async (rule: AlertRule) =>
    ipcBridge.invoke<RulePreviewResult>('rules.preview', rule);

  const importCityMap = async (lines: string[]) => {
    await ipcBridge.invoke('settings.importCityMap', { lines });
  };

  const setNotificationsEnabled = async (enabled: boolean) => {
    setRuntimeAction({
      kind: 'notifications',
      busy: true,
      progress: 20,
      message: enabled ? copy.settings.actionNotificationsOn : copy.settings.actionNotificationsOff,
      error: null,
    });

    try {
      const controlPayload = await ipcBridge.invoke<AppControlResponse>('app.control', {
        action: enabled ? 'enableNotifications' : 'disableNotifications',
      });
      const payload = asControlState(controlPayload, copy.settings.actionUnknownError);
      setControlState({
        notificationsEnabled: payload.notificationsEnabled,
        coreProcessRunning: payload.coreProcessRunning,
        startupStatus: payload.startupStatus,
      });
      setRuntimeAction({
        kind: 'done',
        busy: false,
        progress: 100,
        message: enabled
          ? copy.settings.actionNotificationsOnDone
          : copy.settings.actionNotificationsOffDone,
        error: null,
      });
    } catch (error) {
      setRuntimeAction({
        kind: 'error',
        busy: false,
        progress: 100,
        message: copy.settings.actionUnknownError,
        error:
          formatRuntimeReason(toErrorMessage(error, copy.settings.actionUnknownError), language) ??
          copy.settings.actionUnknownError,
      });
    }
  };

  const stopMonitor = async () => {
    setRuntimeAction({
      kind: 'stopping',
      busy: true,
      progress: 15,
      message: copy.settings.actionStopping,
      error: null,
    });

    try {
      const controlPayload = await ipcBridge.invoke<AppControlResponse>('app.control', {
        action: 'stopMonitor',
      });
      const payload = asControlState(controlPayload, copy.settings.actionUnknownError);
      setControlState({
        notificationsEnabled: payload.notificationsEnabled,
        coreProcessRunning: payload.coreProcessRunning,
        startupStatus: payload.startupStatus,
      });
      const healthPayload = await ipcBridge
        .invoke<AppHealth>('app.getHealth')
        .catch(() => null);
      if (healthPayload) {
        setHealth(normalizeHealthForDisplay(healthPayload, language));
      }
      setRuntimeAction({
        kind: 'done',
        busy: false,
        progress: 100,
        message: copy.settings.actionStopped,
        error: null,
      });
    } catch (error) {
      setRuntimeAction({
        kind: 'error',
        busy: false,
        progress: 100,
        message: copy.settings.actionUnknownError,
        error:
          formatRuntimeReason(toErrorMessage(error, copy.settings.actionUnknownError), language) ??
          copy.settings.actionUnknownError,
      });
    }
  };

  const startMonitor = async () => {
    setRuntimeAction({
      kind: 'starting',
      busy: true,
      progress: 10,
      message: copy.settings.actionStarting,
      error: null,
    });

    const progressRef = { value: 12 };
    const progressTimer = setInterval(() => {
      progressRef.value = Math.min(START_PROGRESS_MAX, progressRef.value + 6);
      setRuntimeAction({
        kind: 'starting',
        busy: true,
        progress: progressRef.value,
        message: copy.settings.actionStarting,
        error: null,
      });
    }, START_PROGRESS_INTERVAL_MS);

    try {
      const controlPayload = await ipcBridge.invoke<AppControlResponse>('app.control', {
        action: 'startMonitor',
      });
      const payload = asControlState(controlPayload, copy.settings.actionUnknownError);
      setControlState({
        notificationsEnabled: payload.notificationsEnabled,
        coreProcessRunning: payload.coreProcessRunning,
        startupStatus: payload.startupStatus,
      });

      setRuntimeAction({
        kind: 'starting',
        busy: true,
        progress: 78,
        message: copy.settings.actionStartingCheck,
        error: null,
      });

      const healthPayload = await ipcBridge
        .invoke<AppHealth>('app.getHealth')
        .catch(() => null);
      if (healthPayload) {
        setHealth(normalizeHealthForDisplay(healthPayload, language));
      }

      const isFeedReady = Boolean(
        healthPayload &&
          (healthPayload.connected ||
            healthPayload.mode === 'live' ||
            healthPayload.mode === 'mock' ||
            healthPayload.startupPhase === 'running'),
      );

      if (isFeedReady) {
        setRuntimeAction({
          kind: 'done',
          busy: false,
          progress: 100,
          message: copy.settings.actionStarted,
          error: null,
        });
      } else {
        const startupReason = payload.startupStatus?.healthReason ?? null;
        const diagnostic =
          formatRuntimeReason(healthPayload?.diagnostic?.trim(), language) ||
          formatRuntimeReason(startupReason, language) ||
          null;
        setRuntimeAction({
          kind: 'done',
          busy: false,
          progress: 92,
          message: diagnostic
            ? `${copy.settings.actionStartedPending} ${diagnostic}`
            : copy.settings.actionStartedPending,
          error: null,
        });
      }
      void refreshAll();
    } catch (error) {
      setRuntimeAction({
        kind: 'error',
        busy: false,
        progress: 100,
        message: copy.settings.actionUnknownError,
        error:
          formatRuntimeReason(toErrorMessage(error, copy.settings.actionUnknownError), language) ??
          copy.settings.actionUnknownError,
      });
    } finally {
      clearInterval(progressTimer);
    }
  };

  const quitApp = async () => {
    setRuntimeAction({
      kind: 'quitting',
      busy: true,
      progress: 25,
      message: copy.settings.actionQuitting,
      error: null,
    });
    try {
      const controlPayload = await ipcBridge.invoke<AppControlResponse>('app.control', {
        action: 'quitApp',
      });
      const payload = asControlState(controlPayload, copy.settings.actionUnknownError);
      setControlState({
        notificationsEnabled: payload.notificationsEnabled,
        coreProcessRunning: payload.coreProcessRunning,
        startupStatus: payload.startupStatus,
      });
    } catch (error) {
      setRuntimeAction({
        kind: 'error',
        busy: false,
        progress: 100,
        message: copy.settings.actionUnknownError,
        error:
          formatRuntimeReason(toErrorMessage(error, copy.settings.actionUnknownError), language) ??
          copy.settings.actionUnknownError,
      });
    }
  };

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    if (loading) return;
    void refreshMarkets();
  }, [
    loading,
    marketQuery.cityKey,
    marketQuery.eventDate,
    marketQuery.limit,
    marketQuery.side,
    marketQuery.sortBy,
    marketQuery.sortDir,
    marketQuery.watchlistedOnly,
  ]);

  useEffect(
    () => () => {
      if (marketTickTimerRef.current !== null) {
        clearTimeout(marketTickTimerRef.current);
      }
      pendingMarketTicksRef.current.clear();
    },
    [],
  );

  useIpcSubscription<AppHealth>('app.health', (payload) => {
    if (payload) {
      setHealth(normalizeHealthForDisplay(payload, language));
    }
  });

  useIpcSubscription<AppControlState>('app.controlState', (payload) => {
    if (payload) {
      setControlState(payload);
    }
  });

  useIpcSubscription<MarketRow[] | MarketQueryResult>('markets.tick', (payload) => {
    const updates = Array.isArray(payload)
      ? payload
      : normalizeMarketResult(payload).rows;
    queueMarketTickUpdates(updates);
  });

  useIpcSubscription<AlertEvent>('alerts.new', (payload) => {
    if (!payload) return;
    setAlerts((prev) => [payload, ...prev].slice(0, 200));
  });

  return {
    mode: bridgeMode as 'live' | 'mock',
    loading,
    health,
    controlState,
    runtimeAction,
    markets,
    marketTotal,
    marketQuery,
    alerts,
    rules,
    settings,
    soundProfiles,
    setMarketQuery,
    refreshMarkets,
    refreshAll,
    acknowledgeAlert,
    previewRule,
    saveRules,
    updateSettings,
    pickSound,
    registerSound,
    previewSound,
    importCityMap,
    setNotificationsEnabled,
    stopMonitor,
    startMonitor,
    quitApp,
  };
};
