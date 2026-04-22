import { app, BrowserWindow } from 'electron';
import path from 'node:path';

import { APP_NAME } from '../shared/constants';
import type { AppControlState, StartupPhase } from '@/shared/contracts';
import {
  DEFAULT_CONTROL_STATE,
  DEFAULT_HEALTH,
  DEFAULT_STARTUP_STATUS,
  EMPTY_SETTINGS_PAYLOAD,
  type EventChannel,
  type EventPayloadMap,
  type RuntimeState,
} from './contracts/ipc';
import { registerIpcHandlers } from './ipc/register-handlers';
import { HiddenAudioWindow } from './services/audio-window';
import {
  CORE_WORKER_HEALTH_INVOKE_TIMEOUT_MS,
  CoreWorkerClient,
} from './services/core-worker-client';
import { ElectronNotificationService } from './services/notification-service';
import { detectSystemProxyUrl } from './services/system-proxy';
import { AppTray } from './services/tray-service';

interface AppShellState {
  isQuitting: boolean;
  mainWindow: BrowserWindow | null;
  runtime: RuntimeState;
}

const STARTUP_MAX_ATTEMPTS = 2;
const STARTUP_POLL_INTERVAL_MS = 500;
const STARTUP_RETRY_DELAY_MS = 800;
const HEALTH_CHECK_TIMEOUT_MS = CORE_WORKER_HEALTH_INVOKE_TIMEOUT_MS + 500;
const STARTUP_ATTEMPT_TIMEOUT_MS =
  (HEALTH_CHECK_TIMEOUT_MS + STARTUP_POLL_INTERVAL_MS) * 2 + STARTUP_RETRY_DELAY_MS;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutReason: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutReason)), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        if (timer) {
          clearTimeout(timer);
        }
        resolve(value);
      },
      (error) => {
        if (timer) {
          clearTimeout(timer);
        }
        reject(error);
      },
    );
  });
};

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: APP_NAME,
    backgroundColor: '#0c111b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  window.once('ready-to-show', () => {
    window.show();
  });

  return window;
};

const showWindow = (window: BrowserWindow | null): void => {
  if (!window || window.isDestroyed()) {
    return;
  }

  if (!window.isVisible()) {
    window.show();
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.focus();
};

const resolveBuiltinSoundDir = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'sounds')
    : path.join(process.cwd(), 'assets', 'sounds');

export const bootstrapAppShell = async (): Promise<void> => {
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.setAppUserModelId('com.polymarket.weather-monitor');

  const shellState: AppShellState = {
    isQuitting: false,
    mainWindow: null,
    runtime: {
      health: { ...DEFAULT_HEALTH },
      controlState: {
        ...DEFAULT_CONTROL_STATE,
        startupStatus: { ...DEFAULT_STARTUP_STATUS },
      },
      settingsPayload: { ...EMPTY_SETTINGS_PAYLOAD },
    },
  };

  const audioWindow = new HiddenAudioWindow();
  const tray = new AppTray();
  const notificationService = new ElectronNotificationService();
  const proxyUrl = detectSystemProxyUrl();
  const coreClient = new CoreWorkerClient({
    dbPath: path.join(app.getPath('userData'), 'polymarket-weather-monitor.sqlite'),
    proxyUrl,
    builtinSoundDir: resolveBuiltinSoundDir(),
  });
  let startupTask: Promise<AppControlState> | null = null;

  const getState = (): RuntimeState => shellState.runtime;
  const setState = (updater: (prev: RuntimeState) => RuntimeState): void => {
    shellState.runtime = updater(shellState.runtime);
  };

  const emitEvent = <C extends EventChannel>(channel: C, payload: EventPayloadMap[C]): void => {
    if (!shellState.mainWindow || shellState.mainWindow.isDestroyed()) {
      return;
    }

    shellState.mainWindow.webContents.send(channel, payload);
  };

  const updateControlState = (
    updater: (previous: AppControlState) => AppControlState,
  ): AppControlState => {
    const nextState = updater(getState().controlState);
    setState((previous) => ({
      ...previous,
      controlState: nextState,
    }));
    notificationService.setEnabled(nextState.notificationsEnabled);
    emitEvent('app.controlState', nextState);
    return nextState;
  };

  const coerceStartupPhase = (
    phase: AppControlState['startupStatus']['phase'] | 'connecting' | 'discovering',
  ): AppControlState['startupStatus']['phase'] =>
    phase as AppControlState['startupStatus']['phase'];

  const isStartupTrackingPhase = (
    phase: AppControlState['startupStatus']['phase'],
  ): boolean =>
    phase === 'starting' ||
    phase === 'retrying' ||
    phase === coerceStartupPhase('connecting') ||
    phase === coerceStartupPhase('discovering');

  const deriveStartupProgressPhase = (
    health: RuntimeState['health'],
    fallbackPhase: AppControlState['startupStatus']['phase'],
  ): AppControlState['startupStatus']['phase'] => {
    if (!health.workerRunning) {
      return fallbackPhase === 'stopped' ? 'stopped' : 'failed';
    }

    if (health.connected || health.startupPhase === 'running') {
      return 'ready';
    }

    const service = health.serviceStatus;
    if (service?.discovery === 'discovering' || service?.discovery === 'idle') {
      return coerceStartupPhase('discovering');
    }

    if (
      service?.websocket === 'connecting' ||
      service?.websocket === 'partial' ||
      service?.discovery === 'ready' ||
      service?.discovery === 'empty'
    ) {
      return coerceStartupPhase('connecting');
    }

    if (fallbackPhase === 'retrying') {
      return 'retrying';
    }

    return coerceStartupPhase('connecting');
  };

  const getHealthReason = (health: RuntimeState['health']): string | null => {
    if (health.connected) {
      return null;
    }
    const service = health.serviceStatus;
    if (!health.workerRunning) {
      return 'core-worker-not-running';
    }
    if (typeof service?.lastError === 'string' && service.lastError.trim()) {
      return service.lastError.trim();
    }
    if (typeof health.diagnostic === 'string' && health.diagnostic.trim()) {
      return health.diagnostic.trim();
    }
    if (service?.discovery === 'discovering') {
      return 'discovering';
    }
    if (service?.discovery === 'empty') {
      return 'discovery-empty';
    }
    if (service?.discovery === 'error') {
      return 'discovery-failed';
    }
    if (service?.websocket === 'connecting') {
      return 'connecting';
    }
    if (service?.websocket === 'partial') {
      return 'partial-connectivity';
    }
    if (service?.websocket === 'disconnected') {
      return service.discovery === 'ready'
        ? 'websocket-disconnected'
        : 'awaiting-websocket';
    }
    if (
      typeof health.reason === 'string' &&
      health.reason.trim() &&
      health.reason !== 'not-started'
    ) {
      return health.reason;
    }
    if (health.shardTotal === 0) {
      return 'awaiting-websocket-shards';
    }
    if (health.shardActive === 0) {
      return 'no-active-shards';
    }
    return 'feed-degraded';
  };

const patchHealth = (
  health: RuntimeState['health'],
  overrides?: {
      reason?: string | null;
      startupPhase?: RuntimeState['health']['startupPhase'];
      diagnostic?: string | null;
    },
  ): RuntimeState['health'] => {
    const reason = overrides?.reason !== undefined ? overrides.reason : getHealthReason(health);
    const startupPhase = overrides?.startupPhase ?? (
      coreClient.isRunning()
        ? health.connected
          ? 'running'
          : 'degraded'
        : 'stopped'
    );
    const diagnostic =
      overrides?.diagnostic !== undefined
        ? overrides.diagnostic
        : reason ?? health.diagnostic ?? null;
  return {
    ...health,
    reason,
    workerRunning: coreClient.isRunning(),
    startupPhase,
    diagnostic,
  };
};

  const resolveStartupHealthReason = (health: RuntimeState['health']): string | null => {
    if (health.connected) {
      return null;
    }
    if (typeof health.diagnostic === 'string' && health.diagnostic.trim()) {
      return health.diagnostic.trim();
    }
    const inferred = getHealthReason(health);
    if (inferred) {
      return inferred;
    }
    return null;
  };

  const syncStartupStatusWithHealth = (health: RuntimeState['health']): void => {
    updateControlState((previous) => {
      const current = previous.startupStatus;
      const shouldTrackStartup =
        previous.coreProcessRunning ||
        isStartupTrackingPhase(current.phase);

      if (!shouldTrackStartup) {
        return previous;
      }

      let nextCoreProcessRunning = previous.coreProcessRunning;
      let nextPhase: StartupPhase = current.phase;
      let nextReason = current.healthReason;
      let nextLastError = current.lastError;

      if (!health.workerRunning) {
        const fallbackReason = resolveStartupHealthReason(health) ?? 'worker-not-running';
        nextCoreProcessRunning = false;
        nextPhase = current.phase === 'stopped' ? 'stopped' : 'failed';
        nextReason = fallbackReason;
        nextLastError = fallbackReason;
      } else if (health.connected || health.startupPhase === 'running') {
        nextCoreProcessRunning = true;
        nextPhase = 'ready';
        nextReason = null;
        nextLastError = null;
      } else {
        nextCoreProcessRunning = true;
        nextPhase = deriveStartupProgressPhase(health, current.phase);
        nextReason = resolveStartupHealthReason(health);
        nextLastError = null;
      }

      const changed =
        previous.coreProcessRunning !== nextCoreProcessRunning ||
        current.phase !== nextPhase ||
        current.healthReason !== nextReason ||
        current.lastError !== nextLastError;

      if (!changed) {
        return previous;
      }

      return {
        ...previous,
        coreProcessRunning: nextCoreProcessRunning,
        startupStatus: {
          ...current,
          phase: nextPhase,
          healthReason: nextReason,
          lastError: nextLastError,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  };

  const setHealth = (nextHealth: RuntimeState['health']): void => {
    setState((previous) => ({
      ...previous,
      health: nextHealth,
    }));
    emitEvent('app.health', nextHealth);
    syncStartupStatusWithHealth(nextHealth);
  };

  const updateStartupStatus = (
    updater: (previous: AppControlState['startupStatus']) => AppControlState['startupStatus'],
  ): AppControlState =>
    updateControlState((previous) => ({
      ...previous,
      startupStatus: updater(previous.startupStatus),
    }));

  const markStartupStatus = (patch: Partial<AppControlState['startupStatus']>): AppControlState =>
    updateStartupStatus((previous) => ({
      ...previous,
      ...patch,
      updatedAt: new Date().toISOString(),
    }));

  const emitDegradedHealth = (reason?: string): RuntimeState['health'] => {
    const degraded = {
      ...getState().health,
      connected: false,
      mode: 'degraded' as const,
      lastSyncAt: new Date().toISOString(),
      droppedEvents: (getState().health.droppedEvents ?? 0) + 1,
      reason: reason ?? getHealthReason(getState().health) ?? 'feed-degraded',
    };
    const patched = patchHealth(degraded, {
      reason: degraded.reason,
      startupPhase: coreClient.isRunning() ? 'degraded' : 'stopped',
      diagnostic: degraded.reason,
    });
    setHealth(patched);
    return patched;
  };

  const refreshWorkerSnapshot = async (): Promise<RuntimeState['health']> => {
    const [settingsPayload, health] = await Promise.all([
      coreClient.invoke('settings.get'),
      withTimeout(
        coreClient.invoke('app.getHealth'),
        HEALTH_CHECK_TIMEOUT_MS,
        'health-check-timeout',
      ),
    ]);
    const patchedHealth = patchHealth(health, {
      reason: health.connected ? null : getHealthReason(health),
    });
    setState((previous) => ({
      ...previous,
      settingsPayload,
    }));
    setHealth(patchedHealth);
    return patchedHealth;
  };

  const isHealthy = (health: RuntimeState['health']): boolean =>
    health.connected || health.mode === 'live' || health.mode === 'mock';

  const waitForStartupReady = async (
    attempt: number,
    fallbackPhase: AppControlState['startupStatus']['phase'],
  ): Promise<
    | {
      ok: true;
      health: RuntimeState['health'];
      feedReady: boolean;
      phase: AppControlState['startupStatus']['phase'];
      reason: string | null;
    }
    | { ok: false; reason: string }
  > => {
    const deadline = Date.now() + STARTUP_ATTEMPT_TIMEOUT_MS;
    let lastReason = 'startup-pending';

    while (Date.now() < deadline) {
      try {
        const health = await withTimeout(
          coreClient.invoke('app.getHealth'),
          HEALTH_CHECK_TIMEOUT_MS,
          `health-check-timeout(attempt=${attempt})`,
        );
        const patchedHealth = patchHealth(health, {
          reason: health.connected ? null : getHealthReason(health),
        });
        setHealth(patchedHealth);
        const healthReason = getHealthReason(patchedHealth);
        const progressPhase = deriveStartupProgressPhase(patchedHealth, fallbackPhase);
        markStartupStatus({
          phase: progressPhase,
          attempts: attempt,
          maxAttempts: STARTUP_MAX_ATTEMPTS,
          healthReason,
        });
        if (isHealthy(patchedHealth)) {
          return {
            ok: true,
            health: patchedHealth,
            feedReady: true,
            phase: 'ready',
            reason: null,
          };
        }
        if (patchedHealth.workerRunning) {
          return {
            ok: true,
            health: patchedHealth,
            feedReady: false,
            phase: progressPhase,
            reason: healthReason ?? resolveStartupHealthReason(patchedHealth) ?? 'startup-pending',
          };
        }
        lastReason = healthReason ?? 'startup-pending';
      } catch (error) {
        lastReason = `health-check-failed: ${toErrorMessage(error, 'unknown-error')}`;
        emitDegradedHealth(lastReason);
        markStartupStatus({
          attempts: attempt,
          maxAttempts: STARTUP_MAX_ATTEMPTS,
          healthReason: lastReason,
          lastError: lastReason,
        });
      }

      await sleep(STARTUP_POLL_INTERVAL_MS);
    }

    return {
      ok: false,
      reason: `startup timed out on attempt ${attempt}: ${lastReason}`,
    };
  };

  const runStartMonitoring = async (): Promise<AppControlState> => {
    const startedAt = new Date().toISOString();
    updateControlState((previous) => ({
      ...previous,
      coreProcessRunning: false,
      startupStatus: {
        ...previous.startupStatus,
        phase: 'starting',
        attempts: 0,
        maxAttempts: STARTUP_MAX_ATTEMPTS,
        startedAt,
        updatedAt: startedAt,
        healthReason: 'startup-begin',
        lastError: null,
      },
    }));

    for (let attempt = 1; attempt <= STARTUP_MAX_ATTEMPTS; attempt += 1) {
      const phase = attempt === 1 ? 'starting' : 'retrying';
      markStartupStatus({
        phase,
        attempts: attempt,
        maxAttempts: STARTUP_MAX_ATTEMPTS,
        startedAt,
        healthReason: attempt === 1 ? 'worker-starting' : 'worker-retrying',
      });

      if (coreClient.isRunning()) {
        await coreClient.stop().catch(() => undefined);
      }
      coreClient.start();

      const startupResult = await waitForStartupReady(
        attempt,
        phase === 'starting' ? coerceStartupPhase('connecting') : phase,
      );
      if (startupResult.ok) {
        const nextState = updateControlState((previous) => ({
          ...previous,
          coreProcessRunning: true,
          startupStatus: {
            ...previous.startupStatus,
            phase: startupResult.phase,
            attempts: attempt,
            maxAttempts: STARTUP_MAX_ATTEMPTS,
            startedAt,
            updatedAt: new Date().toISOString(),
            healthReason: startupResult.reason,
            lastError: null,
          },
        }));
        void refreshWorkerSnapshot().catch((error) => {
          const reason = `snapshot-refresh-failed:${toErrorMessage(error, 'unknown-error')}`;
          emitDegradedHealth(reason);
          markStartupStatus({
            phase: 'ready',
            healthReason: reason,
            lastError: reason,
          });
        });
        return nextState;
      }

      emitDegradedHealth(startupResult.reason);
      markStartupStatus({
        phase: attempt < STARTUP_MAX_ATTEMPTS ? 'retrying' : 'failed',
        attempts: attempt,
        maxAttempts: STARTUP_MAX_ATTEMPTS,
        startedAt,
        healthReason: startupResult.reason,
        lastError: startupResult.reason,
      });

      if (attempt < STARTUP_MAX_ATTEMPTS) {
        await coreClient.stop().catch(() => undefined);
        await sleep(STARTUP_RETRY_DELAY_MS);
      }
    }

    await coreClient.stop().catch(() => undefined);
    const failedReason =
      getState().controlState.startupStatus.lastError ?? 'startup-failed-without-reason';
    emitDegradedHealth(failedReason);
    updateControlState((previous) => ({
      ...previous,
      coreProcessRunning: false,
      startupStatus: {
        ...previous.startupStatus,
        phase: 'failed',
        attempts: STARTUP_MAX_ATTEMPTS,
        maxAttempts: STARTUP_MAX_ATTEMPTS,
        startedAt: previous.startupStatus.startedAt ?? startedAt,
        updatedAt: new Date().toISOString(),
        healthReason: failedReason,
        lastError: failedReason,
      },
    }));
    throw new Error(`STARTUP_TIMEOUT: ${failedReason}`);
  };

  const setNotificationsEnabled = (enabled: boolean): AppControlState =>
    updateControlState((previous) => ({
      ...previous,
      notificationsEnabled: enabled,
    }));

  const startMonitoring = async (): Promise<AppControlState> => {
    if (startupTask) {
      return startupTask;
    }
    startupTask = runStartMonitoring().finally(() => {
      startupTask = null;
    });
    return startupTask;
  };

  const stopMonitoring = async (): Promise<AppControlState> => {
    await coreClient.stop();
    emitDegradedHealth('monitor-stopped-by-user');
    return updateControlState((previous) => ({
      ...previous,
      coreProcessRunning: false,
      startupStatus: {
        ...previous.startupStatus,
        phase: 'stopped',
        attempts: 0,
        maxAttempts: STARTUP_MAX_ATTEMPTS,
        startedAt: null,
        updatedAt: new Date().toISOString(),
        healthReason: 'monitor-stopped-by-user',
        lastError: null,
      },
    }));
  };

  const quitApplication = (): AppControlState => {
    const nextState = updateControlState((previous) => ({
      ...previous,
      coreProcessRunning: false,
      startupStatus: {
        ...previous.startupStatus,
        phase: 'stopped',
        attempts: 0,
        maxAttempts: STARTUP_MAX_ATTEMPTS,
        startedAt: null,
        updatedAt: new Date().toISOString(),
        healthReason: 'application-quitting',
        lastError: null,
      },
    }));
    shellState.isQuitting = true;
    setTimeout(() => {
      app.quit();
    }, 0);
    return nextState;
  };

  const createManagedMainWindow = (): BrowserWindow => {
    const mainWindow = createMainWindow();
    mainWindow.on('close', (event) => {
      if (shellState.isQuitting) {
        return;
      }
      event.preventDefault();
      mainWindow.hide();
    });

    mainWindow.on('closed', () => {
      shellState.mainWindow = null;
    });

    return mainWindow;
  };

  const onReady = (): void => {
    coreClient.on('error', (error) => {
      const reason = `worker-error:${toErrorMessage(error, 'unknown-error')}`;
      updateControlState((previous) => ({
        ...previous,
        coreProcessRunning: false,
        startupStatus: {
          ...previous.startupStatus,
          phase: 'failed',
          updatedAt: new Date().toISOString(),
          healthReason: reason,
          lastError: reason,
        },
      }));
      emitDegradedHealth(reason);
      console.error('[core-worker]', error);
    });

    void startMonitoring().catch((error) => {
      const reason = `startup-on-ready-failed:${toErrorMessage(error, 'unknown-error')}`;
      emitDegradedHealth(reason);
      markStartupStatus({
        phase: 'failed',
        maxAttempts: STARTUP_MAX_ATTEMPTS,
        healthReason: reason,
        lastError: reason,
      });
      console.error('[startup]', error);
    });

    shellState.mainWindow = createManagedMainWindow();
    audioWindow.create();

    tray.create({
      showMainWindow: () => showWindow(shellState.mainWindow),
      quitApp: () => {
        quitApplication();
      },
    });

    registerIpcHandlers({
      coreClient,
      getRuntimeState: getState,
      setRuntimeState: setState,
      emitEvent,
      getControlState: () => getState().controlState,
      setNotificationsEnabled,
      startMonitoring,
      stopMonitoring,
      quitApplication,
      previewSoundFromPath: (filePath, gain) => audioWindow.playFromPath(filePath, gain),
    });

    coreClient.on('alerts.new', async (alert) => {
      const runtime = getState();
      if (!runtime.controlState.notificationsEnabled) {
        return;
      }

      notificationService.notifyAlert(alert);
      const selectedSoundId =
        alert.soundProfileId?.trim() || runtime.settingsPayload.settings.selectedSoundProfileId;
      const selectedSound = runtime.settingsPayload.soundProfiles.find(
        (profile) => profile.id === selectedSoundId,
      );
      if (runtime.settingsPayload.settings.backgroundAudio && selectedSound?.filePath) {
        await audioWindow.playFromPath(selectedSound.filePath, selectedSound.gain);
      }
    });
  };

  app.on('before-quit', () => {
    updateControlState((previous) => ({
      ...previous,
      coreProcessRunning: false,
      startupStatus: {
        ...previous.startupStatus,
        phase: 'stopped',
        attempts: 0,
        maxAttempts: STARTUP_MAX_ATTEMPTS,
        startedAt: null,
        updatedAt: new Date().toISOString(),
        healthReason: 'application-quitting',
        lastError: null,
      },
    }));
    emitDegradedHealth('application-quitting');
    shellState.isQuitting = true;
  });

  app.on('activate', () => {
    if (!shellState.mainWindow || shellState.mainWindow.isDestroyed()) {
      shellState.mainWindow = createManagedMainWindow();
      return;
    }

    showWindow(shellState.mainWindow);
  });

  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') {
      return;
    }
  });

  app.on('quit', () => {
    tray.destroy();
    audioWindow.destroy();
    void coreClient.stop();
  });

  await app.whenReady();
  onReady();
};
