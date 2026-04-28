import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bridgeMode, ipcBridge } from '../api/ipcBridge';
import { useI18n } from '../i18n';
import {
  DEFAULT_ALERT_RETENTION_DAYS,
  DEFAULT_TICK_RETENTION_DAYS,
} from '../../shared/constants';
import type {
  AppControlState,
  AlertEvent,
  AlertListCursor,
  AlertListResult,
  AlertRule,
  AppHealth,
  AppSettings,
  MarketQuery,
  MarketQueryResult,
  MarketRow,
  PreviewSoundPayload,
  PreviewSoundResult,
  RegisterSoundPayload,
  RuntimeDiagnosticsPackageResult,
  StorageMaintenanceResult,
  StorageMaintenanceSummary,
  RuntimeStorageSummary,
  RulePreviewResult,
  StorageBackupResult,
  StorageCleanupResult,
  RuntimeActionFeedback,
  SettingsPayload,
  SoundProfile,
} from '../types/contracts';
import { useIpcSubscription } from './useIpc';

type MonitorIssueTone = 'warning' | 'danger';
type MonitorIssueSource = 'startup' | 'health' | 'runtimeAction' | 'storage';

export interface MonitorRuntimeIssue {
  id: string;
  tone: MonitorIssueTone;
  source: MonitorIssueSource;
  sourceLabel: string;
  title: string;
  detail: string;
}

interface MonitorConsoleState {
  mode: 'live' | 'mock';
  loading: boolean;
  health: AppHealth;
  controlState: AppControlState;
  runtimeAction: RuntimeActionFeedback;
  runtimeIssues: MonitorRuntimeIssue[];
  markets: MarketRow[];
  marketTotal: number;
  marketQuery: MarketQuery;
  alerts: AlertEvent[];
  alertsTotal: number;
  alertsHasMore: boolean;
  alertsLoadingMore: boolean;
  alertsLoadMoreError: string | null;
  rules: AlertRule[];
  settings: AppSettings;
  soundProfiles: SoundProfile[];
  storageSummary: RuntimeStorageSummary | null;
  storageMaintenance: StorageMaintenanceSummary | null;
  setMarketQuery: (query: Partial<MarketQuery>) => void;
  refreshMarkets: () => Promise<void>;
  refreshAll: () => Promise<void>;
  loadMoreAlerts: () => Promise<void>;
  acknowledgeAlert: (id: string) => Promise<void>;
  previewRule: (rule: AlertRule) => Promise<RulePreviewResult>;
  saveRules: (nextRules: AlertRule[]) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  pickSound: (profileId: string) => Promise<void>;
  registerSound: (payload?: RegisterSoundPayload) => Promise<void>;
  clearStorageCache: () => Promise<StorageCleanupResult>;
  createStorageBackup: () => Promise<StorageBackupResult>;
  createDiagnosticsPackage: () => Promise<RuntimeDiagnosticsPackageResult>;
  runStorageMaintenance: () => Promise<StorageMaintenanceResult>;
  previewSound: (payload: PreviewSoundPayload) => Promise<PreviewSoundResult>;
  importCityMap: (lines: string[]) => Promise<number>;
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
  tickRetentionDays: DEFAULT_TICK_RETENTION_DAYS,
  alertRetentionDays: DEFAULT_ALERT_RETENTION_DAYS,
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

const normalizeAlertResult = (payload: unknown): AlertListResult => {
  if (!payload) {
    return { rows: [], total: 0, hasMore: false };
  }
  if (Array.isArray(payload)) {
    const rows = payload as AlertEvent[];
    return { rows, total: rows.length, hasMore: false };
  }

  const shaped = payload as Partial<AlertListResult>;
  const rows = Array.isArray(shaped.rows) ? shaped.rows : [];
  const nextCursor =
    shaped.nextCursor &&
    typeof shaped.nextCursor.id === 'string' &&
    typeof shaped.nextCursor.triggeredAt === 'string'
      ? shaped.nextCursor
      : undefined;

  return {
    rows,
    total: typeof shaped.total === 'number' ? shaped.total : rows.length,
    hasMore: shaped.hasMore === true,
    ...(nextCursor ? { nextCursor } : {}),
  };
};

const prependUniqueAlert = (alerts: AlertEvent[], alert: AlertEvent): AlertEvent[] => {
  const withoutCurrent = alerts.filter((item) => item.id !== alert.id);
  return [alert, ...withoutCurrent];
};

const appendUniqueAlerts = (current: AlertEvent[], incoming: AlertEvent[]): AlertEvent[] => {
  const next = [...current];
  const seen = new Set(current.map((item) => item.id));
  for (const alert of incoming) {
    if (seen.has(alert.id)) {
      continue;
    }
    seen.add(alert.id);
    next.push(alert);
  }
  return next;
};

const mergeSettingsPayload = (
  payload: unknown,
  previousSettings: AppSettings,
  previousSounds: SoundProfile[],
  previousStorageSummary: RuntimeStorageSummary | null,
  previousStorageMaintenance: StorageMaintenanceSummary | null,
) => {
  if (!payload) {
    return {
      settings: previousSettings,
      soundProfiles: previousSounds,
      storageSummary: previousStorageSummary,
      storageMaintenance: previousStorageMaintenance,
    };
  }
  const shaped = payload as Partial<SettingsPayload>;
  const settings = shaped.settings ?? previousSettings;
  const soundProfiles = shaped.soundProfiles ?? previousSounds;
  const storageSummary = shaped.storageSummary ?? previousStorageSummary;
  const storageMaintenance = shaped.storageMaintenance ?? previousStorageMaintenance;
  return { settings, soundProfiles, storageSummary, storageMaintenance };
};

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

const getAlertRequestFallbackMessage = (
  mode: 'refresh' | 'loadMore',
  language: 'zh-CN' | 'en-US',
) => {
  if (language === 'en-US') {
    return mode === 'loadMore'
      ? 'Failed to load more alerts. Please retry.'
      : 'Failed to refresh alerts. Please retry.';
  }

  return mode === 'loadMore'
    ? '加载更多告警失败，请稍后重试。'
    : '刷新告警列表失败，请稍后重试。';
};

const toAlertRequestErrorMessage = (
  error: unknown,
  mode: 'refresh' | 'loadMore',
  language: 'zh-CN' | 'en-US',
) => toErrorMessage(error, getAlertRequestFallbackMessage(mode, language));

const normalizeAlertResultPayload = (payload: unknown): AlertListResult => {
  if (payload === null || payload === undefined) {
    throw new Error('Alert list payload missing.');
  }
  return normalizeAlertResult(payload);
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
const ALERT_BATCH_WINDOW_MS = 120;
const MAX_PENDING_ALERTS = 24;
const START_PROGRESS_MAX = 68;
const START_PROGRESS_INTERVAL_MS = 320;
const MARKET_LIMIT_DEFAULT = 2000;
const MARKET_LIMIT_MIN = 1;
const ALERT_PAGE_LIMIT = 200;

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

const buildMonitorRuntimeIssues = ({
  health,
  controlState,
  runtimeAction,
  storageSummary,
  language,
}: {
  health: AppHealth;
  controlState: AppControlState;
  runtimeAction: RuntimeActionFeedback;
  storageSummary: RuntimeStorageSummary | null;
  language: 'zh-CN' | 'en-US';
}): MonitorRuntimeIssue[] => {
  const issues: MonitorRuntimeIssue[] = [];
  const seenKeys = new Set<string>();
  const pushIssue = (issue: MonitorRuntimeIssue) => {
    const dedupeKey = `${issue.source}|${issue.title}|${issue.detail}`;
    if (seenKeys.has(dedupeKey)) {
      return;
    }
    seenKeys.add(dedupeKey);
    issues.push(issue);
  };

  const startupStatus = controlState.startupStatus;
  const startupReason =
    formatRuntimeReason(startupStatus?.lastError, language) ||
    formatRuntimeReason(startupStatus?.healthReason, language) ||
    formatRuntimeReason(health.diagnostic, language) ||
    null;
  const workerReason =
    startupReason ||
    formatRuntimeReason(health.serviceStatus?.lastError, language) ||
    (language === 'zh-CN' ? '监控进程没有成功启动。' : 'The monitor worker did not start.');

  if (startupStatus?.phase === 'failed') {
    pushIssue({
      id: 'startup-failed',
      tone: 'danger',
      source: 'startup',
      sourceLabel: language === 'zh-CN' ? '启动' : 'Startup',
      title: language === 'zh-CN' ? '启动失败' : 'Startup failed',
      detail:
        startupReason ||
        (language === 'zh-CN' ? '启动状态返回失败，但没有提供更多原因。' : 'Startup failed without additional detail.'),
    });
  }

  const workerOffline =
    controlState.coreProcessRunning === false ||
    health.workerRunning === false ||
    health.serviceStatus?.coreWorker === 'stopped' ||
    health.serviceStatus?.coreWorker === 'error';

  if (workerOffline && startupStatus?.phase !== 'stopped') {
    pushIssue({
      id: 'worker-offline',
      tone: 'danger',
      source: 'health',
      sourceLabel: language === 'zh-CN' ? 'Worker' : 'Worker',
      title: language === 'zh-CN' ? 'Worker 未在线' : 'Worker offline',
      detail: workerReason,
    });
  }

  if (health.diagnostic && health.diagnostic !== startupReason) {
    pushIssue({
      id: 'health-diagnostic',
      tone: 'warning',
      source: 'health',
      sourceLabel: language === 'zh-CN' ? '健康状态' : 'Health',
      title: language === 'zh-CN' ? '运行状态异常' : 'Runtime health issue',
      detail: health.diagnostic,
    });
  }

  if (health.serviceStatus?.lastError && health.serviceStatus.lastError !== startupReason) {
    pushIssue({
      id: 'service-last-error',
      tone: health.serviceStatus.lastErrorSource === 'db' ? 'danger' : 'warning',
      source: 'health',
      sourceLabel: language === 'zh-CN' ? '健康状态' : 'Health',
      title:
        language === 'zh-CN'
          ? `服务异常${health.serviceStatus.lastErrorSource ? ` · ${health.serviceStatus.lastErrorSource}` : ''}`
          : `Service issue${health.serviceStatus.lastErrorSource ? ` · ${health.serviceStatus.lastErrorSource}` : ''}`,
      detail: health.serviceStatus.lastError,
    });
  }

  if (runtimeAction.error) {
    pushIssue({
      id: 'runtime-action-error',
      tone: 'danger',
      source: 'runtimeAction',
      sourceLabel: language === 'zh-CN' ? '操作反馈' : 'Action',
      title: language === 'zh-CN' ? '最近一次操作失败' : 'Last action failed',
      detail: runtimeAction.error,
    });
  }

  if (storageSummary && storageSummary.mainDbExists === false) {
    pushIssue({
      id: 'storage-main-db-missing',
      tone: 'warning',
      source: 'storage',
      sourceLabel: language === 'zh-CN' ? '存储' : 'Storage',
      title: language === 'zh-CN' ? '主库未创建' : 'Main database missing',
      detail:
        language === 'zh-CN'
          ? `未找到主库文件：${storageSummary.mainDbPath}`
          : `Main database file was not found: ${storageSummary.mainDbPath}`,
    });
  }

  return issues;
};

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
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [alertsHasMore, setAlertsHasMore] = useState(false);
  const [alertsLoadingMore, setAlertsLoadingMore] = useState(false);
  const [alertsLoadMoreError, setAlertsLoadMoreError] = useState<string | null>(null);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [soundProfiles, setSoundProfiles] = useState<SoundProfile[]>([]);
  const [storageSummary, setStorageSummary] = useState<RuntimeStorageSummary | null>(null);
  const [storageMaintenance, setStorageMaintenance] =
    useState<StorageMaintenanceSummary | null>(null);
  const [marketQuery, setMarketQueryState] = useState<MarketQuery>(
    normalizeMarketQuery({
      limit: MARKET_LIMIT_DEFAULT,
      sortBy: 'volume24h',
      sortDir: 'desc',
    }),
  );
  const marketsRef = useRef<MarketRow[]>([]);
  const alertsRef = useRef<AlertEvent[]>([]);
  const alertsTotalRef = useRef(0);
  const alertsHasMoreRef = useRef(false);
  const alertsNextCursorRef = useRef<AlertListCursor | undefined>(undefined);
  const marketQueryRef = useRef(marketQuery);
  const pendingMarketTicksRef = useRef<Map<string, MarketRow>>(new Map());
  const marketTickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAlertsRef = useRef<AlertEvent[]>([]);
  const alertBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const marketRefreshSerialRef = useRef(0);
  const emptyMarketRecoveryPendingRef = useRef(false);
  const readyRecoveryConsumedRef = useRef(false);
  const hasCompletedInitialRefreshRef = useRef(false);
  const runtimeIssues = useMemo(
    () =>
      loading
        ? []
        : buildMonitorRuntimeIssues({
            health,
            controlState,
            runtimeAction,
            storageSummary,
            language,
          }),
    [controlState, health, language, loading, runtimeAction, storageSummary],
  );

  const applyMarketResult = useCallback((result: MarketQueryResult) => {
    marketsRef.current = result.rows;
    startTransition(() => {
      setMarkets(result.rows);
      setMarketTotal(result.total);
    });
  }, []);

  const applyAlertResult = useCallback(
    (result: AlertListResult, mode: 'replace' | 'append' = 'replace') => {
      const nextRows =
        mode === 'append'
          ? appendUniqueAlerts(alertsRef.current, result.rows)
          : result.rows;
      alertsRef.current = nextRows;
      alertsTotalRef.current = result.total;
      alertsHasMoreRef.current = result.hasMore;
      alertsNextCursorRef.current = result.nextCursor;
      startTransition(() => {
        setAlerts(nextRows);
        setAlertsTotal(result.total);
        setAlertsHasMore(result.hasMore);
      });
    },
    [],
  );

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

  const refreshMarkets = useCallback(async () => {
    const serial = marketRefreshSerialRef.current + 1;
    marketRefreshSerialRef.current = serial;

    const payload = await ipcBridge.invoke<MarketQueryResult>('markets.query', marketQueryRef.current);
    if (marketRefreshSerialRef.current !== serial) {
      return;
    }

    applyMarketResult(normalizeMarketResult(payload));
  }, [applyMarketResult]);

  const requestEmptyMarketRecovery = useCallback(() => {
    if (emptyMarketRecoveryPendingRef.current) {
      return;
    }

    emptyMarketRecoveryPendingRef.current = true;
    void refreshMarkets().finally(() => {
      emptyMarketRecoveryPendingRef.current = false;
    });
  }, [refreshMarkets]);

  const flushPendingMarketTicks = useCallback(() => {
    marketTickTimerRef.current = null;
    const pending = pendingMarketTicksRef.current;
    if (pending.size === 0) {
      return;
    }

    const currentMarkets = marketsRef.current;
    if (currentMarkets.length === 0) {
      pending.clear();
      requestEmptyMarketRecovery();
      return;
    }

    let changed = false;
    const next = currentMarkets.map((row) => {
      const incoming = pending.get(row.marketId);
      if (!incoming) return row;
      changed = true;
      return incoming;
    });
    pending.clear();

    if (!changed) {
      return;
    }

    marketsRef.current = next;
    startTransition(() => {
      setMarkets(next);
    });
  }, [requestEmptyMarketRecovery]);

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

  const flushPendingAlerts = useCallback(() => {
    alertBatchTimerRef.current = null;
    const pendingAlerts = pendingAlertsRef.current;
    if (pendingAlerts.length === 0) {
      return;
    }

    pendingAlertsRef.current = [];
    const currentAlerts = alertsRef.current;
    let nextAlerts = currentAlerts;
    let nextTotal = alertsTotalRef.current;
    const seenAlertIds = new Set(currentAlerts.map((item) => item.id));

    for (const alert of pendingAlerts) {
      if (!seenAlertIds.has(alert.id)) {
        nextTotal += 1;
        seenAlertIds.add(alert.id);
      }
      nextAlerts = prependUniqueAlert(nextAlerts, alert);
    }

    const hadLoadedAll = currentAlerts.length >= alertsTotalRef.current;
    const nextHasMore = hadLoadedAll ? nextAlerts.length < nextTotal : true;

    alertsRef.current = nextAlerts;
    alertsTotalRef.current = nextTotal;
    alertsHasMoreRef.current = nextHasMore;

    startTransition(() => {
      setAlerts(nextAlerts);
      setAlertsTotal(nextTotal);
      setAlertsHasMore(nextHasMore);
    });
  }, []);

  const scheduleAlertBatchFlush = useCallback(() => {
    if (alertBatchTimerRef.current !== null) {
      return;
    }

    alertBatchTimerRef.current = setTimeout(() => {
      flushPendingAlerts();
    }, ALERT_BATCH_WINDOW_MS);
  }, [flushPendingAlerts]);

  const queueIncomingAlert = useCallback(
    (alert: AlertEvent) => {
      const pendingAlerts = pendingAlertsRef.current;
      pendingAlerts.push(alert);

      if (pendingAlerts.length >= MAX_PENDING_ALERTS) {
        if (alertBatchTimerRef.current !== null) {
          clearTimeout(alertBatchTimerRef.current);
          alertBatchTimerRef.current = null;
        }
        flushPendingAlerts();
        return;
      }

      scheduleAlertBatchFlush();
    },
    [flushPendingAlerts, scheduleAlertBatchFlush],
  );

  const refreshAll = async () => {
    const showBlockingLoading = !hasCompletedInitialRefreshRef.current;
    if (showBlockingLoading) {
      setLoading(true);
    }

    try {
      const alertRequest = ipcBridge
        .invoke<AlertListResult>('alerts.list', { limit: ALERT_PAGE_LIMIT })
        .then((payload) => ({ ok: true as const, payload }))
        .catch((error) => ({ ok: false as const, error }));
      const [
        healthPayload,
        controlPayload,
        marketPayload,
        alertResult,
        settingsPayload,
        rulesPayload,
      ] =
        await Promise.all([
          ipcBridge.invoke<AppHealth>('app.getHealth'),
          ipcBridge.invoke<AppControlState>('app.getControlState'),
          ipcBridge.invoke<MarketQueryResult>('markets.query', marketQuery),
          alertRequest,
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
      applyMarketResult(normalizedMarkets);
      setAlertsLoadingMore(false);
      if (alertResult.ok) {
        applyAlertResult(normalizeAlertResultPayload(alertResult.payload), 'replace');
        setAlertsLoadMoreError(null);
      } else {
        setAlertsLoadMoreError(
          toAlertRequestErrorMessage(alertResult.error, 'refresh', language),
        );
      }

      const mergedSettings = mergeSettingsPayload(
        settingsPayload,
        settings,
        soundProfiles,
        storageSummary,
        storageMaintenance,
      );
      setSettings(mergedSettings.settings);
      setSoundProfiles(mergedSettings.soundProfiles);
      setStorageSummary(mergedSettings.storageSummary ?? null);
      setStorageMaintenance(mergedSettings.storageMaintenance ?? null);

      if (Array.isArray(rulesPayload?.rows)) {
        setRules(rulesPayload.rows);
      }
    } finally {
      hasCompletedInitialRefreshRef.current = true;
      if (showBlockingLoading) {
        setLoading(false);
      }
    }
  };

  const loadMoreAlerts = useCallback(async () => {
    if (alertsLoadingMore || !alertsHasMoreRef.current || !alertsNextCursorRef.current) {
      return;
    }

    setAlertsLoadingMore(true);
    setAlertsLoadMoreError(null);
    try {
      const payload = await ipcBridge.invoke<AlertListResult>('alerts.list', {
        limit: ALERT_PAGE_LIMIT,
        cursor: alertsNextCursorRef.current,
      });
      applyAlertResult(normalizeAlertResultPayload(payload), 'append');
      setAlertsLoadMoreError(null);
    } catch (error) {
      setAlertsLoadMoreError(toAlertRequestErrorMessage(error, 'loadMore', language));
    } finally {
      setAlertsLoadingMore(false);
    }
  }, [alertsLoadingMore, applyAlertResult, language]);

  const isFeedReady = Boolean(
    health.connected ||
      health.mode === 'live' ||
      health.mode === 'mock' ||
      health.startupPhase === 'running' ||
      controlState.startupStatus?.phase === 'ready',
  );

  const acknowledgeAlert = async (id: string) => {
    await ipcBridge.invoke('alerts.ack', { id });
    const nextAlerts = alertsRef.current.map((item) =>
      item.id === id ? { ...item, acknowledged: true } : item,
    );
    alertsRef.current = nextAlerts;
    startTransition(() => {
      setAlerts(nextAlerts);
    });
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
    const merged = mergeSettingsPayload(
      payload,
      settings,
      soundProfiles,
      storageSummary,
      storageMaintenance,
    );
    setSettings(merged.settings);
    setSoundProfiles(merged.soundProfiles);
    setStorageSummary(merged.storageSummary ?? null);
    setStorageMaintenance(merged.storageMaintenance ?? null);
  };

  const pickSound = async (profileId: string) => {
    const payload = await ipcBridge.invoke<SettingsPayload>('settings.pickSound', { id: profileId });
    const merged = mergeSettingsPayload(
      payload,
      settings,
      soundProfiles,
      storageSummary,
      storageMaintenance,
    );
    setSettings(merged.settings);
    setSoundProfiles(merged.soundProfiles);
    setStorageSummary(merged.storageSummary ?? null);
    setStorageMaintenance(merged.storageMaintenance ?? null);
  };

  const registerSound = async (payload?: RegisterSoundPayload) => {
    const nextPayload = await ipcBridge.invoke<SettingsPayload>('settings.registerSound', payload);
    const merged = mergeSettingsPayload(
      nextPayload,
      settings,
      soundProfiles,
      storageSummary,
      storageMaintenance,
    );
    setSettings(merged.settings);
    setSoundProfiles(merged.soundProfiles);
    setStorageSummary(merged.storageSummary ?? null);
    setStorageMaintenance(merged.storageMaintenance ?? null);
  };

  const createStorageBackup = async (): Promise<StorageBackupResult> => {
    const result = await ipcBridge.invoke<StorageBackupResult>('storage.createBackup');
    setStorageSummary(result.storageSummary);
    return result;
  };

  const createDiagnosticsPackage = async (): Promise<RuntimeDiagnosticsPackageResult> =>
    ipcBridge.invoke<RuntimeDiagnosticsPackageResult>('storage.createDiagnostics');

  const clearStorageCache = async (): Promise<StorageCleanupResult> => {
    const result = await ipcBridge.invoke<StorageCleanupResult>('storage.clearCache');
    setStorageSummary(result.storageSummary);
    return result;
  };

  const runStorageMaintenance = async (): Promise<StorageMaintenanceResult> => {
    const result = await ipcBridge.invoke<StorageMaintenanceResult>('storage.runMaintenance');
    setStorageMaintenance(result.summary);
    if (result.storageSummary) {
      setStorageSummary(result.storageSummary);
    }
    return result;
  };

  const previewSound = async (payload: PreviewSoundPayload) => {
    const response = await ipcBridge.invoke<PreviewSoundResult>(
      'settings.previewSound',
      payload,
    );
    return {
      ok: true as const,
      played: Boolean(response?.played),
      ...(response?.fallback ? { fallback: response.fallback } : {}),
    };
  };

  const previewRule = async (rule: AlertRule) =>
    ipcBridge.invoke<RulePreviewResult>('rules.preview', rule);

  const importCityMap = async (lines: string[]) => {
    const response = await ipcBridge.invoke<{ ok: true; imported: number }>(
      'settings.importCityMap',
      { lines },
    );
    const imported = Number(response?.imported ?? 0);
    if (imported > 0) {
      await refreshMarkets();
    }
    return imported;
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
    marketsRef.current = markets;
  }, [markets]);

  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);

  useEffect(() => {
    marketQueryRef.current = marketQuery;
  }, [marketQuery]);

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

  useEffect(() => {
    if (!isFeedReady) {
      readyRecoveryConsumedRef.current = false;
      return;
    }

    if (loading || readyRecoveryConsumedRef.current) {
      return;
    }

    readyRecoveryConsumedRef.current = true;
    if (marketsRef.current.length === 0) {
      requestEmptyMarketRecovery();
    }
  }, [isFeedReady, loading, requestEmptyMarketRecovery]);

  useEffect(
    () => () => {
      if (marketTickTimerRef.current !== null) {
        clearTimeout(marketTickTimerRef.current);
      }
      if (alertBatchTimerRef.current !== null) {
        clearTimeout(alertBatchTimerRef.current);
      }
      pendingMarketTicksRef.current.clear();
      pendingAlertsRef.current = [];
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
    queueIncomingAlert(payload);
  });

  return {
    mode: bridgeMode as 'live' | 'mock',
    loading,
    health,
    controlState,
    runtimeAction,
    runtimeIssues,
    markets,
    marketTotal,
    marketQuery,
    alerts,
    alertsTotal,
    alertsHasMore,
    alertsLoadingMore,
    alertsLoadMoreError,
    rules,
    settings,
    soundProfiles,
    storageSummary,
    storageMaintenance,
    setMarketQuery,
    refreshMarkets,
    refreshAll,
    loadMoreAlerts,
    acknowledgeAlert,
    previewRule,
    saveRules,
    updateSettings,
    pickSound,
    registerSound,
    clearStorageCache,
    createStorageBackup,
    createDiagnosticsPackage,
    runStorageMaintenance,
    previewSound,
    importCityMap,
    setNotificationsEnabled,
    stopMonitor,
    startMonitor,
    quitApp,
  };
};
