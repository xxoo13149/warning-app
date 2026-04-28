import { app, BrowserWindow } from 'electron';
import path from 'node:path';

import { APP_NAME, APP_USER_MODEL_ID } from '../shared/constants';
import type { AppControlState } from '@/shared/contracts';
import {
  DEFAULT_CONTROL_STATE,
  DEFAULT_HEALTH,
  DEFAULT_STARTUP_STATUS,
  EMPTY_SETTINGS_PAYLOAD,
  type AppNavigateEvent,
  type AlertTriggeredEvent,
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
import { AlertDispatchPolicy } from './services/alert-dispatch-policy';
import { resolveAlertSoundPlan } from './services/alert-sound';
import { ElectronNotificationService } from './services/notification-service';
import { ShutdownCoordinator } from './services/shutdown-coordinator';
import { detectSystemProxyUrl } from './services/system-proxy';
import { AppTray } from './services/tray-service';
import { createRuntimeLogger } from './services/runtime-log';
import { LifecycleRunGate } from './services/lifecycle-run-gate';
import {
  APPLICATION_QUITTING_REASON,
  deriveStartupProgressPhase,
  getRuntimeHealthReason,
  markMonitorStoppedByUser,
  markRuntimeFailed,
  markRuntimeStarting,
  markShutdownBegin,
  markWorkerErrorFailed,
  MONITOR_STOPPED_BY_USER_REASON,
  syncControlStateWithHealth,
} from './services/runtime-control-state';
import type { RuntimePaths } from './services/runtime-paths';
import { inspectRuntimeStorageSummary } from './services/runtime-storage';

interface AppShellState {
  mainWindow: BrowserWindow | null;
  runtime: RuntimeState;
}

type RendererNavigationRoute = AppNavigateEvent['target'];
type RendererNavigationSource = 'notification-click' | 'tray';

interface RendererNavigationPayload extends AppNavigateEvent {
  source: RendererNavigationSource;
  alertId?: string;
  ruleId?: string;
  severity?: AlertTriggeredEvent['severity'];
  triggeredAt?: string;
}

const RENDERER_NAVIGATION_CHANNEL = 'app.navigate';
const STARTUP_MAX_ATTEMPTS = 2;
const STARTUP_POLL_INTERVAL_MS = 500;
const STARTUP_RETRY_DELAY_MS = 800;
const HEALTH_CHECK_TIMEOUT_MS = CORE_WORKER_HEALTH_INVOKE_TIMEOUT_MS + 500;
const STARTUP_ATTEMPT_TIMEOUT_MS =
  (HEALTH_CHECK_TIMEOUT_MS + STARTUP_POLL_INTERVAL_MS) * 2 + STARTUP_RETRY_DELAY_MS;
const ALERT_SOUND_TIMEOUT_MS = 1_500;
const ALERT_NOTIFICATION_BURST_WINDOW_MS = 15_000;
const ALERT_NOTIFICATION_BURST_LIMIT = 6;

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

export const bootstrapAppShell = async (runtimePaths: RuntimePaths): Promise<void> => {
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.setName(APP_NAME);
  app.setAppUserModelId(APP_USER_MODEL_ID);

  const shellState: AppShellState = {
    mainWindow: null,
    runtime: {
      health: { ...DEFAULT_HEALTH },
      controlState: {
        ...DEFAULT_CONTROL_STATE,
        startupStatus: { ...DEFAULT_STARTUP_STATUS },
      },
      settingsPayload: {
        ...EMPTY_SETTINGS_PAYLOAD,
        storageSummary: inspectRuntimeStorageSummary(runtimePaths),
      },
    },
  };
  const logStartup = createRuntimeLogger('startup.log', runtimePaths.logsDir, 'app-shell');
  const logNotification = createRuntimeLogger(
    'notification.log',
    runtimePaths.logsDir,
    'notification',
  );

  const audioWindow = new HiddenAudioWindow();
  const tray = new AppTray();
  const notificationService = new ElectronNotificationService({
    log: logNotification,
  });
  const alertDispatchPolicy = new AlertDispatchPolicy({
    burstWindowMs: ALERT_NOTIFICATION_BURST_WINDOW_MS,
    burstLimit: ALERT_NOTIFICATION_BURST_LIMIT,
  });
  const proxyUrl = detectSystemProxyUrl();
  const coreClient = new CoreWorkerClient({
    dbPath: runtimePaths.mainDbPath,
    proxyUrl,
    builtinSoundDir: resolveBuiltinSoundDir(),
  });
  let startupTask: Promise<AppControlState> | null = null;
  const lifecycleRunGate = new LifecycleRunGate();
  let shutdownCoordinator: ShutdownCoordinator<AppControlState> | null = null;
  let detachRuntimeEventForwarders: (() => void) | null = null;
  let focusMainWindowOnReady = false;

  const getState = (): RuntimeState => shellState.runtime;
  const setState = (updater: (prev: RuntimeState) => RuntimeState): void => {
    shellState.runtime = updater(shellState.runtime);
  };
  const isShutdownRequested = (): boolean => {
    const coordinator = shutdownCoordinator;
    return lifecycleRunGate.isShutdownRequested() ||
      (coordinator ? coordinator.isShuttingDown() || coordinator.canQuitApp() : false);
  };
  const nextLifecycleGeneration = (): number => lifecycleRunGate.beginRun();
  const invalidateLifecycleGeneration = (
    reason: string,
    options?: { shutdown?: boolean },
  ): number => {
    const generation = lifecycleRunGate.invalidate(reason, options);
    logStartup(`Lifecycle generation invalidated: ${reason}.`);
    return generation;
  };
  const isLifecycleGenerationCurrent = (generation: number): boolean =>
    lifecycleRunGate.isCurrent(generation) && !isShutdownRequested();

  const emitEvent = <C extends EventChannel>(channel: C, payload: EventPayloadMap[C]): void => {
    if (!shellState.mainWindow || shellState.mainWindow.isDestroyed()) {
      return;
    }

    shellState.mainWindow.webContents.send(channel, payload);
  };

  const emitRendererNavigation = (
    window: BrowserWindow,
    payload: RendererNavigationPayload,
  ): void => {
    const sendNavigation = (): void => {
      if (window.isDestroyed() || window.webContents.isDestroyed()) {
        return;
      }
      window.webContents.send(RENDERER_NAVIGATION_CHANNEL, payload);
    };

    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', sendNavigation);
      return;
    }

    sendNavigation();
  };

  const showMainWindowAndNavigate = (payload: RendererNavigationPayload): void => {
    if (!shellState.mainWindow || shellState.mainWindow.isDestroyed()) {
      shellState.mainWindow = createManagedMainWindow();
    }

    showWindow(shellState.mainWindow);
    emitRendererNavigation(shellState.mainWindow, payload);
  };

  const showTrayRoute = (route: RendererNavigationRoute): void => {
    showMainWindowAndNavigate({
      target: route,
      source: 'tray',
    });
  };

  const emitRuntimeSnapshot = (): void => {
    emitEvent('app.controlState', getState().controlState);
    emitEvent('app.health', getState().health);
  };

  const runTrayRuntimeAction = async (
    action: () => AppControlState | Promise<AppControlState>,
  ): Promise<void> => {
    try {
      await action();
    } catch (error) {
      logStartup('Tray runtime action failed.', error);
    } finally {
      emitRuntimeSnapshot();
      tray.refresh();
    }
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
    tray.refresh();
    return nextState;
  };

  const logNotificationEvent = (
    event: string,
    details?: Record<string, unknown>,
    error?: unknown,
  ): void => {
    logNotification(
      JSON.stringify({
        event,
        ...(details ?? {}),
      }),
      error,
    );
  };

  const suspendAlertDispatch = (reason: string): void => {
    const changed = alertDispatchPolicy.suspend(reason);
    notificationService.closeAll();
    if (changed) {
      logNotificationEvent('alert.dispatch_gate', {
        state: 'suspended',
        reason,
      });
    }
  };

  const resumeAlertDispatch = (reason: string): void => {
    if (!alertDispatchPolicy.resume()) {
      return;
    }
    logNotificationEvent('alert.dispatch_gate', {
      state: 'open',
      reason,
    });
  };

  const getWindowNotificationState = (): {
    visible: boolean;
    focused: boolean;
  } => {
    const mainWindow = shellState.mainWindow;
    if (!mainWindow || mainWindow.isDestroyed()) {
      return {
        visible: false,
        focused: false,
      };
    }
    return {
      visible: mainWindow.isVisible(),
      focused: mainWindow.isFocused(),
    };
  };

  const patchHealth = (
    health: RuntimeState['health'],
    overrides?: {
      reason?: string | null;
      startupPhase?: RuntimeState['health']['startupPhase'];
      diagnostic?: string | null;
    },
  ): RuntimeState['health'] => {
    const reason =
      overrides?.reason !== undefined ? overrides.reason : getRuntimeHealthReason(health);
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

  const syncStartupStatusWithHealth = (health: RuntimeState['health']): void => {
    updateControlState((previous) =>
      syncControlStateWithHealth(previous, health, {
        shutdownRequested: isShutdownRequested(),
        updatedAt: new Date().toISOString(),
      }),
    );
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
  ): AppControlState => {
    if (isShutdownRequested()) {
      return getState().controlState;
    }

    return updateControlState((previous) => ({
      ...previous,
      startupStatus: updater(previous.startupStatus),
    }));
  };

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
      reason: reason ?? getRuntimeHealthReason(getState().health) ?? 'feed-degraded',
    };
    const patched = patchHealth(degraded, {
      reason: degraded.reason,
      startupPhase: coreClient.isRunning() ? 'degraded' : 'stopped',
      diagnostic: degraded.reason,
    });
    setHealth(patched);
    return patched;
  };

  const refreshWorkerSnapshot = async (
    generation?: number,
  ): Promise<RuntimeState['health']> => {
    const [workerSettingsPayload, health] = await Promise.all([
      coreClient.invoke('settings.get'),
      withTimeout(
        coreClient.invoke('app.getHealth'),
        HEALTH_CHECK_TIMEOUT_MS,
        'health-check-timeout',
      ),
    ]);
    if (generation !== undefined && !isLifecycleGenerationCurrent(generation)) {
      throw new Error('startup-cancelled');
    }
    const settingsPayload = {
      ...workerSettingsPayload,
      storageSummary: inspectRuntimeStorageSummary(runtimePaths),
    };
    const patchedHealth = patchHealth(health, {
      reason: health.connected ? null : getRuntimeHealthReason(health),
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
    generation: number,
  ): Promise<
    | {
      ok: true;
      health: RuntimeState['health'];
      feedReady: boolean;
      phase: AppControlState['startupStatus']['phase'];
      reason: string | null;
    }
    | { ok: false; reason: string; cancelled?: boolean }
  > => {
    const deadline = Date.now() + STARTUP_ATTEMPT_TIMEOUT_MS;
    let lastReason = 'startup-pending';

    while (Date.now() < deadline) {
      if (!isLifecycleGenerationCurrent(generation)) {
        return { ok: false, reason: 'startup-cancelled', cancelled: true };
      }
      try {
        const health = await withTimeout(
          coreClient.invoke('app.getHealth'),
          HEALTH_CHECK_TIMEOUT_MS,
          `health-check-timeout(attempt=${attempt})`,
        );
        if (!isLifecycleGenerationCurrent(generation)) {
          return { ok: false, reason: 'startup-cancelled', cancelled: true };
        }
        const patchedHealth = patchHealth(health, {
          reason: health.connected ? null : getRuntimeHealthReason(health),
        });
        setHealth(patchedHealth);
        const healthReason = getRuntimeHealthReason(patchedHealth);
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
            reason: healthReason ?? 'startup-pending',
          };
        }
        lastReason = healthReason ?? 'startup-pending';
      } catch (error) {
        if (!isLifecycleGenerationCurrent(generation)) {
          return { ok: false, reason: 'startup-cancelled', cancelled: true };
        }
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

  const runStartMonitoring = async (generation: number): Promise<AppControlState> => {
    const startedAt = new Date().toISOString();
    if (!isLifecycleGenerationCurrent(generation)) {
      return getState().controlState;
    }
    updateControlState((previous) =>
      markRuntimeStarting(previous, {
        maxAttempts: STARTUP_MAX_ATTEMPTS,
        startedAt,
        updatedAt: startedAt,
      }),
    );

    for (let attempt = 1; attempt <= STARTUP_MAX_ATTEMPTS; attempt += 1) {
      if (!isLifecycleGenerationCurrent(generation)) {
        return getState().controlState;
      }
      const phase = attempt === 1 ? 'starting' : 'retrying';
      logStartup(`Starting core worker attempt ${attempt}/${STARTUP_MAX_ATTEMPTS}.`);
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
      if (!isLifecycleGenerationCurrent(generation)) {
        return getState().controlState;
      }
      coreClient.start();

      const startupResult = await waitForStartupReady(
        attempt,
        phase === 'starting' ? 'connecting' : phase,
        generation,
      );
      if (
        (!startupResult.ok && startupResult.cancelled) ||
        !isLifecycleGenerationCurrent(generation)
      ) {
        logStartup(`Core worker startup attempt ${attempt} cancelled.`);
        return getState().controlState;
      }
      if (startupResult.ok) {
        logStartup(
          `Core worker startup attempt ${attempt} completed. feedReady=${String(startupResult.feedReady)} phase=${startupResult.phase} reason=${startupResult.reason ?? 'none'}`,
        );
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
        void refreshWorkerSnapshot(generation).catch((error) => {
          if (!isLifecycleGenerationCurrent(generation)) {
            return;
          }
          const reason = `snapshot-refresh-failed:${toErrorMessage(error, 'unknown-error')}`;
          logStartup('Refreshing worker snapshot failed after startup.', error);
          emitDegradedHealth(reason);
          markStartupStatus({
            phase: 'ready',
            healthReason: reason,
            lastError: reason,
          });
        });
        return nextState;
      }

      if (!isLifecycleGenerationCurrent(generation)) {
        return getState().controlState;
      }
      emitDegradedHealth(startupResult.reason);
      logStartup(`Core worker startup attempt ${attempt} failed: ${startupResult.reason}`);
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
    if (!isLifecycleGenerationCurrent(generation)) {
      return getState().controlState;
    }
    const failedReason =
      getState().controlState.startupStatus.lastError ?? 'startup-failed-without-reason';
    logStartup(`Core worker startup exhausted retries: ${failedReason}`);
    emitDegradedHealth(failedReason);
    updateControlState((previous) =>
      markRuntimeFailed(previous, {
        attempts: STARTUP_MAX_ATTEMPTS,
        maxAttempts: STARTUP_MAX_ATTEMPTS,
        startedAt: previous.startupStatus.startedAt ?? startedAt,
        updatedAt: new Date().toISOString(),
        reason: failedReason,
      }),
    );
    throw new Error(`STARTUP_TIMEOUT: ${failedReason}`);
  };

  const setNotificationsEnabled = (enabled: boolean): AppControlState =>
    updateControlState((previous) => ({
      ...previous,
      notificationsEnabled: enabled,
    }));

  const startMonitoring = async (): Promise<AppControlState> => {
    if (isShutdownRequested()) {
      return getState().controlState;
    }
    if (startupTask) {
      return startupTask;
    }
    const generation = nextLifecycleGeneration();
    resumeAlertDispatch('monitor-starting');
    const task = runStartMonitoring(generation).finally(() => {
      if (startupTask === task) {
        startupTask = null;
      }
    });
    startupTask = task;
    return startupTask;
  };

  const stopMonitoring = async (): Promise<AppControlState> => {
    const stopGeneration = invalidateLifecycleGeneration('monitor-stopping');
    startupTask = null;
    suspendAlertDispatch('monitor-stopping');
    const stoppedState = updateControlState((previous) =>
      markMonitorStoppedByUser(previous, {
        maxAttempts: STARTUP_MAX_ATTEMPTS,
        updatedAt: new Date().toISOString(),
      }),
    );
    await coreClient.stop();
    if (!isLifecycleGenerationCurrent(stopGeneration)) {
      return getState().controlState;
    }
    emitDegradedHealth(MONITOR_STOPPED_BY_USER_REASON);
    return updateControlState((previous) =>
      markMonitorStoppedByUser(previous, {
        maxAttempts: STARTUP_MAX_ATTEMPTS,
        updatedAt: new Date().toISOString(),
      }),
    ) ?? stoppedState;
  };

  const handleCoreWorkerError = (error: Error): void => {
    if (isShutdownRequested()) {
      return;
    }

    suspendAlertDispatch('worker-error');
    const errorMessage = toErrorMessage(error, 'unknown-error');
    const reason = `worker-error:${errorMessage}`;
    logStartup(`Core worker emitted fatal error: ${reason}`, error);
    updateControlState((previous) =>
      markWorkerErrorFailed(previous, {
        updatedAt: new Date().toISOString(),
        errorMessage,
      }),
    );
    emitDegradedHealth(reason);
    console.error('[core-worker]', error);
  };

  const handleIncomingAlert = async (alert: EventPayloadMap['alerts.new']): Promise<void> => {
    const runtime = getState();
    const windowState = getWindowNotificationState();
    const shutdownRequested = isShutdownRequested();
    const { initialDecision, toastDecision, quietHoursActive } = alertDispatchPolicy.resolve({
      runtime,
      alert,
      windowState,
      shutdownRequested,
    });
    logNotificationEvent('alert.received', {
      alertId: alert.id,
      ruleId: alert.ruleId,
      source: alert.source ?? 'realtime',
      severity: alert.severity,
      triggeredAt: alert.triggeredAt,
      decision: initialDecision.reason,
      toastDecision: toastDecision.reason,
      notificationsEnabled: runtime.controlState.notificationsEnabled,
      quietHoursActive,
      shutdownRequested,
      windowVisible: windowState.visible,
      windowFocused: windowState.focused,
    });
    if (!initialDecision.allowed) {
      return;
    }

    const soundPlan = resolveAlertSoundPlan(runtime, alert);
    const silentToast = soundPlan.notificationSilentByDefault || soundPlan.shouldAttemptPlayback;

    if (!toastDecision.allowed) {
      logNotificationEvent('alert.toast_suppressed', {
        alertId: alert.id,
        ruleId: alert.ruleId,
        source: alert.source ?? 'realtime',
        reason: toastDecision.reason,
      });
    } else {
      notificationService.notifyAlert(alert, {
        silent: silentToast,
        alertId: alert.id,
        source: alert.source,
        onClick: ({ alert: clickedAlert, alertId }) => {
          const targetAlert = clickedAlert ?? alert;
          showMainWindowAndNavigate({
            target: 'alerts',
            source: 'notification-click',
            alertId: alertId ?? targetAlert.id,
            ruleId: targetAlert.ruleId,
            severity: targetAlert.severity,
            triggeredAt: targetAlert.triggeredAt,
          });
        },
      });
      alertDispatchPolicy.recordNotification();
      logNotificationEvent('alert.notified', {
        alertId: alert.id,
        ruleId: alert.ruleId,
        source: alert.source ?? 'realtime',
        silent: silentToast,
        notificationSilentByDefault: soundPlan.notificationSilentByDefault,
        playbackRequested: soundPlan.shouldAttemptPlayback,
      });
    }

    void (async () => {
      if (!soundPlan.shouldAttemptPlayback) {
        logNotificationEvent('alert.sound_result', {
          alertId: alert.id,
          source: alert.source ?? 'realtime',
          attempted: false,
          played: false,
          timedOut: false,
          gain: soundPlan.gain,
          filePath: soundPlan.filePath,
        });
        return;
      }

      try {
        const playedAlertSound = await withTimeout(
          audioWindow.playFromPath(soundPlan.filePath, soundPlan.gain),
          ALERT_SOUND_TIMEOUT_MS,
          'alert-sound-timeout',
        );
        logNotificationEvent('alert.sound_result', {
          alertId: alert.id,
          source: alert.source ?? 'realtime',
          attempted: true,
          played: playedAlertSound,
          timedOut: false,
          gain: soundPlan.gain,
          filePath: soundPlan.filePath,
        });
      } catch (error) {
        logNotificationEvent(
          'alert.sound_result',
          {
            alertId: alert.id,
            source: alert.source ?? 'realtime',
            attempted: true,
            played: false,
            timedOut: true,
            gain: soundPlan.gain,
            filePath: soundPlan.filePath,
          },
          error,
        );
      }
    })();
  };

  const detachForegroundAlertSideEffects = (): void => {
    coreClient.off('error', handleCoreWorkerError);
    coreClient.off('alerts.new', handleIncomingAlert);
    detachRuntimeEventForwarders?.();
    detachRuntimeEventForwarders = null;
  };

  shutdownCoordinator = new ShutdownCoordinator<AppControlState>({
    beginShutdown: () => {
      invalidateLifecycleGeneration(APPLICATION_QUITTING_REASON, { shutdown: true });
      startupTask = null;
      suspendAlertDispatch('application-quitting');
      logNotificationEvent('shutdown.begin', {
        stage: 'preparing',
      });
      const nextState = updateControlState((previous) =>
        markShutdownBegin(previous, {
          maxAttempts: STARTUP_MAX_ATTEMPTS,
          updatedAt: new Date().toISOString(),
        }),
      );

      emitDegradedHealth(APPLICATION_QUITTING_REASON);
      return nextState;
    },
    getSteps: () => [
      {
        name: 'detach-alert-side-effects',
        run: () => {
          logNotificationEvent('shutdown.step', {
            step: 'detach-alert-side-effects',
          });
          detachForegroundAlertSideEffects();
        },
      },
      {
        name: 'core-worker',
        run: async () => {
          logNotificationEvent('shutdown.step', {
            step: 'core-worker',
          });
          await coreClient.stop().catch(() => undefined);
        },
      },
      {
        name: 'notifications',
        run: () => {
          logNotificationEvent('shutdown.step', {
            step: 'notifications',
          });
          notificationService.destroy();
        },
      },
      {
        name: 'tray',
        run: () => {
          tray.destroy();
        },
      },
      {
        name: 'audio-window',
        run: () => {
          audioWindow.destroy();
        },
      },
    ],
    requestQuit: () => {
      app.quit();
    },
    forceExit: (exitCode) => {
      app.exit(exitCode);
    },
  });
  const requestAppShutdown = (): Promise<AppControlState> => {
    invalidateLifecycleGeneration('shutdown-requested', { shutdown: true });
    startupTask = null;
    suspendAlertDispatch('shutdown-requested');
    const coordinator = shutdownCoordinator;
    return coordinator ? coordinator.requestShutdown() : Promise.resolve(getState().controlState);
  };

  const createManagedMainWindow = (): BrowserWindow => {
    const mainWindow = createMainWindow();
    mainWindow.on('close', (event) => {
      if (isShutdownRequested()) {
        return;
      }
      event.preventDefault();
      suspendAlertDispatch('main-window-close');
      logStartup('Main window close requested full application shutdown.');
      void requestAppShutdown();
    });

    mainWindow.on('closed', () => {
      shellState.mainWindow = null;
    });

    return mainWindow;
  };

  const onReady = (): void => {
    coreClient.on('error', handleCoreWorkerError);
    resumeAlertDispatch('app-ready');

    void startMonitoring().catch((error) => {
      const reason = `startup-on-ready-failed:${toErrorMessage(error, 'unknown-error')}`;
      logStartup(`startMonitoring failed during app ready: ${reason}`, error);
      emitDegradedHealth(reason);
      markStartupStatus({
        phase: 'failed',
        maxAttempts: STARTUP_MAX_ATTEMPTS,
        healthReason: reason,
        lastError: reason,
      });
      console.error('[startup]', error);
    });

    if (!shellState.mainWindow || shellState.mainWindow.isDestroyed()) {
      shellState.mainWindow = createManagedMainWindow();
    } else {
      showWindow(shellState.mainWindow);
    }
    if (focusMainWindowOnReady) {
      logStartup('Applying deferred main window reveal from second-instance request.');
      showWindow(shellState.mainWindow);
      focusMainWindowOnReady = false;
    }
    audioWindow.create();

    tray.create({
      showDashboard: () => showTrayRoute('dashboard'),
      showAlerts: () => showTrayRoute('alerts'),
      showMarketOverview: () => showTrayRoute('explorer'),
      showRulesSettings: () => showTrayRoute('rules'),
      setNotificationsEnabled: (enabled) => {
        void runTrayRuntimeAction(() => setNotificationsEnabled(enabled));
      },
      startMonitoring: () => {
        void runTrayRuntimeAction(startMonitoring);
      },
      stopMonitoring: () => {
        void runTrayRuntimeAction(stopMonitoring);
      },
      quitApp: () => {
        void requestAppShutdown();
      },
      getControlState: () => getState().controlState,
    });

    detachRuntimeEventForwarders = registerIpcHandlers({
      coreClient,
      runtimePaths,
      getRuntimeState: getState,
      setRuntimeState: setState,
      setRuntimeHealth: setHealth,
      emitEvent,
      getControlState: () => getState().controlState,
      setNotificationsEnabled,
      startMonitoring,
      stopMonitoring,
      quitApplication: requestAppShutdown,
      previewSoundFromPath: (filePath, gain) => audioWindow.previewFromPath(filePath, gain),
    });

    coreClient.on('alerts.new', handleIncomingAlert);
  };

  app.on('before-quit', (event) => {
    if (shutdownCoordinator?.canQuitApp()) {
      return;
    }
    event.preventDefault();
    void requestAppShutdown();
  });

  app.on('second-instance', () => {
    if (isShutdownRequested()) {
      logStartup('Second instance requested during shutdown; ignoring.');
      return;
    }

    if (!app.isReady()) {
      focusMainWindowOnReady = true;
      logStartup('Second instance requested before app ready; deferring main window reveal.');
      return;
    }

    if (!shellState.mainWindow || shellState.mainWindow.isDestroyed()) {
      focusMainWindowOnReady = true;
      logStartup('Second instance requested without an existing main window; creating one.');
      shellState.mainWindow = createManagedMainWindow();
      return;
    }

    focusMainWindowOnReady = false;
    logStartup('Second instance requested; focusing existing main window.');
    showWindow(shellState.mainWindow);
  });

  app.on('activate', () => {
    if (isShutdownRequested()) {
      return;
    }

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
    if (shutdownCoordinator?.canQuitApp()) {
      return;
    }
    logStartup('window-all-closed fired; requesting full application shutdown.');
    void requestAppShutdown();
  });

  app.on('quit', () => {
    logNotificationEvent('shutdown.complete', {
      stage: 'finished',
    });
    shutdownCoordinator?.markQuitComplete();
  });

  await app.whenReady();
  onReady();
};
