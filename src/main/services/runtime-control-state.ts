import type { StartupPhase } from '@/shared/contracts';
import type { AppControlState, RuntimeHealth } from '../contracts/ipc';

export const MONITOR_STOPPED_BY_USER_REASON = 'monitor-stopped-by-user';
export const APPLICATION_QUITTING_REASON = 'application-quitting';
export const WORKER_ERROR_REASON_PREFIX = 'worker-error';

interface RuntimeControlTimestamp {
  updatedAt: string;
}

export interface MarkRuntimeStartingInput extends RuntimeControlTimestamp {
  maxAttempts: number;
  startedAt: string;
}

export interface MarkRuntimeStoppedInput extends RuntimeControlTimestamp {
  maxAttempts?: number;
  reason?: string;
}

export interface MarkRuntimeFailedInput extends RuntimeControlTimestamp {
  reason: string;
  attempts?: number;
  maxAttempts?: number;
  startedAt?: string | null;
}

export interface MarkWorkerErrorFailedInput extends RuntimeControlTimestamp {
  errorMessage?: string | null;
}

export interface SyncControlStateWithHealthInput extends RuntimeControlTimestamp {
  shutdownRequested?: boolean;
}

export const markRuntimeStarting = (
  previous: AppControlState,
  input: MarkRuntimeStartingInput,
): AppControlState => ({
  ...previous,
  coreProcessRunning: false,
  startupStatus: {
    ...previous.startupStatus,
    phase: 'starting',
    attempts: 0,
    maxAttempts: input.maxAttempts,
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    healthReason: 'startup-begin',
    lastError: null,
  },
});

export const markMonitorStoppedByUser = (
  previous: AppControlState,
  input: MarkRuntimeStoppedInput,
): AppControlState =>
  markRuntimeStopped(previous, {
    ...input,
    reason: input.reason ?? MONITOR_STOPPED_BY_USER_REASON,
    notificationsEnabled: previous.notificationsEnabled,
  });

export const markShutdownBegin = (
  previous: AppControlState,
  input: MarkRuntimeStoppedInput,
): AppControlState =>
  markRuntimeStopped(previous, {
    ...input,
    reason: input.reason ?? APPLICATION_QUITTING_REASON,
    notificationsEnabled: false,
  });

export const markRuntimeFailed = (
  previous: AppControlState,
  input: MarkRuntimeFailedInput,
): AppControlState => ({
  ...previous,
  coreProcessRunning: false,
  startupStatus: {
    ...previous.startupStatus,
    phase: 'failed',
    attempts: input.attempts ?? previous.startupStatus.attempts,
    maxAttempts: input.maxAttempts ?? previous.startupStatus.maxAttempts,
    startedAt:
      input.startedAt !== undefined ? input.startedAt : previous.startupStatus.startedAt,
    updatedAt: input.updatedAt,
    healthReason: input.reason,
    lastError: input.reason,
  },
});

export const markWorkerErrorFailed = (
  previous: AppControlState,
  input: MarkWorkerErrorFailedInput,
): AppControlState =>
  markRuntimeFailed(previous, {
    updatedAt: input.updatedAt,
    reason: createWorkerErrorReason(input.errorMessage),
  });

export const createWorkerErrorReason = (errorMessage?: string | null): string => {
  const trimmed = errorMessage?.trim();
  return `${WORKER_ERROR_REASON_PREFIX}:${trimmed || 'unknown-error'}`;
};

export const syncControlStateWithHealth = (
  previous: AppControlState,
  health: RuntimeHealth,
  input: SyncControlStateWithHealthInput,
): AppControlState => {
  if (input.shutdownRequested) {
    return previous;
  }

  const current = previous.startupStatus;
  const shouldTrackStartup =
    previous.coreProcessRunning || isStartupTrackingPhase(current.phase);

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
      updatedAt: input.updatedAt,
    },
  };
};

export const deriveStartupProgressPhase = (
  health: RuntimeHealth,
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
    return 'discovering';
  }

  if (
    service?.websocket === 'connecting' ||
    service?.websocket === 'partial' ||
    service?.discovery === 'ready' ||
    service?.discovery === 'empty'
  ) {
    return 'connecting';
  }

  if (fallbackPhase === 'retrying') {
    return 'retrying';
  }

  return 'connecting';
};

export const getRuntimeHealthReason = (health: RuntimeHealth): string | null => {
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
    return service.discovery === 'ready' ? 'websocket-disconnected' : 'awaiting-websocket';
  }
  if (typeof health.reason === 'string' && health.reason.trim() && health.reason !== 'not-started') {
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

const markRuntimeStopped = (
  previous: AppControlState,
  input: MarkRuntimeStoppedInput & {
    notificationsEnabled: boolean;
    reason: string;
  },
): AppControlState => ({
  ...previous,
  notificationsEnabled: input.notificationsEnabled,
  coreProcessRunning: false,
  startupStatus: {
    ...previous.startupStatus,
    phase: 'stopped',
    attempts: 0,
    maxAttempts: input.maxAttempts ?? previous.startupStatus.maxAttempts,
    startedAt: null,
    updatedAt: input.updatedAt,
    healthReason: input.reason,
    lastError: null,
  },
});

const resolveStartupHealthReason = (health: RuntimeHealth): string | null => {
  if (health.connected) {
    return null;
  }
  if (typeof health.diagnostic === 'string' && health.diagnostic.trim()) {
    return health.diagnostic.trim();
  }
  return getRuntimeHealthReason(health);
};

const isStartupTrackingPhase = (phase: AppControlState['startupStatus']['phase']): boolean =>
  phase === 'starting' ||
  phase === 'retrying' ||
  phase === 'connecting' ||
  phase === 'discovering';
