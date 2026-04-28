import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONTROL_STATE,
  DEFAULT_HEALTH,
  type AppControlState,
  type RuntimeHealth,
} from '../../src/main/contracts/ipc';
import {
  APPLICATION_QUITTING_REASON,
  markRuntimeStarting,
  markMonitorStoppedByUser,
  markShutdownBegin,
  markWorkerErrorFailed,
  MONITOR_STOPPED_BY_USER_REASON,
  syncControlStateWithHealth,
} from '../../src/main/services/runtime-control-state';

const NOW = '2026-04-25T12:00:00.000Z';
const STARTED_AT = '2026-04-25T11:59:00.000Z';
const ZERO_DATE = new Date(0).toISOString();

const createControlState = (
  overrides?: Partial<AppControlState>,
): AppControlState => ({
  ...DEFAULT_CONTROL_STATE,
  coreProcessRunning: true,
  startupStatus: {
    ...DEFAULT_CONTROL_STATE.startupStatus,
    phase: 'starting',
    attempts: 1,
    maxAttempts: 2,
    startedAt: STARTED_AT,
    updatedAt: STARTED_AT,
    healthReason: 'worker-starting',
    lastError: null,
  },
  ...overrides,
});

const createHealth = (overrides?: Partial<RuntimeHealth>): RuntimeHealth => ({
  ...DEFAULT_HEALTH,
  connected: false,
  mode: 'degraded',
  workerRunning: true,
  startupPhase: 'degraded',
  diagnostic: null,
  reason: 'feed-degraded',
  serviceStatus: createServiceStatus(),
  ...overrides,
});

const createServiceStatus = (
  overrides?: Partial<NonNullable<RuntimeHealth['serviceStatus']>>,
): NonNullable<RuntimeHealth['serviceStatus']> => ({
  coreWorker: 'running',
  discovery: 'ready',
  websocket: 'partial',
  dataFreshness: 'unknown',
  activeShards: 0,
  totalShards: 0,
  lagMs: 0,
  lastUpdateAt: ZERO_DATE,
  lastError: null,
  lastErrorSource: 'startup',
  ...overrides,
});

describe('runtime control state', () => {
  it('marks startup as beginning without claiming the worker is ready yet', () => {
    const previous = createControlState({
      coreProcessRunning: false,
      startupStatus: {
        ...createControlState().startupStatus,
        phase: 'stopped',
        startedAt: null,
      },
    });

    const next = markRuntimeStarting(previous, {
      maxAttempts: 2,
      startedAt: STARTED_AT,
      updatedAt: NOW,
    });

    expect(next.coreProcessRunning).toBe(false);
    expect(next.startupStatus).toMatchObject({
      phase: 'starting',
      attempts: 0,
      maxAttempts: 2,
      startedAt: STARTED_AT,
      updatedAt: NOW,
      healthReason: 'startup-begin',
      lastError: null,
    });
  });

  it('marks monitor-stopped-by-user without disabling notifications', () => {
    const previous = createControlState({
      notificationsEnabled: true,
    });

    const next = markMonitorStoppedByUser(previous, {
      updatedAt: NOW,
      maxAttempts: 2,
    });

    expect(next).toEqual({
      ...previous,
      notificationsEnabled: true,
      coreProcessRunning: false,
      startupStatus: {
        ...previous.startupStatus,
        phase: 'stopped',
        attempts: 0,
        maxAttempts: 2,
        startedAt: null,
        updatedAt: NOW,
        healthReason: MONITOR_STOPPED_BY_USER_REASON,
        lastError: null,
      },
    });
  });

  it('marks worker errors as failed with a stable worker-error reason', () => {
    const previous = createControlState();

    const next = markWorkerErrorFailed(previous, {
      updatedAt: NOW,
      errorMessage: 'boom',
    });

    expect(next.coreProcessRunning).toBe(false);
    expect(next.startupStatus.phase).toBe('failed');
    expect(next.startupStatus.updatedAt).toBe(NOW);
    expect(next.startupStatus.healthReason).toBe('worker-error:boom');
    expect(next.startupStatus.lastError).toBe('worker-error:boom');
  });

  it('marks shutdown begin as stopped and disables notifications', () => {
    const previous = createControlState({
      notificationsEnabled: true,
    });

    const next = markShutdownBegin(previous, {
      updatedAt: NOW,
      maxAttempts: 2,
    });

    expect(next.notificationsEnabled).toBe(false);
    expect(next.coreProcessRunning).toBe(false);
    expect(next.startupStatus).toEqual({
      ...previous.startupStatus,
      phase: 'stopped',
      attempts: 0,
      maxAttempts: 2,
      startedAt: null,
      updatedAt: NOW,
      healthReason: APPLICATION_QUITTING_REASON,
      lastError: null,
    });
  });

  it('syncs connected health to a ready running control state', () => {
    const previous = createControlState({
      coreProcessRunning: false,
      startupStatus: {
        ...createControlState().startupStatus,
        phase: 'starting',
        healthReason: 'connecting',
        lastError: 'previous-error',
      },
    });

    const next = syncControlStateWithHealth(
      previous,
      createHealth({
        connected: true,
        mode: 'live',
        startupPhase: 'degraded',
      }),
      {
        updatedAt: NOW,
      },
    );

    expect(next.coreProcessRunning).toBe(true);
    expect(next.startupStatus.phase).toBe('ready');
    expect(next.startupStatus.updatedAt).toBe(NOW);
    expect(next.startupStatus.healthReason).toBeNull();
    expect(next.startupStatus.lastError).toBeNull();
  });

  it('syncs running startup health to ready even before connected flips true', () => {
    const previous = createControlState();

    const next = syncControlStateWithHealth(
      previous,
      createHealth({
        connected: false,
        startupPhase: 'running',
      }),
      {
        updatedAt: NOW,
      },
    );

    expect(next.coreProcessRunning).toBe(true);
    expect(next.startupStatus.phase).toBe('ready');
    expect(next.startupStatus.healthReason).toBeNull();
    expect(next.startupStatus.lastError).toBeNull();
  });

  it('syncs degraded health while keeping the worker marked as running', () => {
    const previous = createControlState();

    const next = syncControlStateWithHealth(
      previous,
      createHealth({
        connected: false,
        startupPhase: 'degraded',
        serviceStatus: createServiceStatus({
          coreWorker: 'running',
          discovery: 'ready',
          websocket: 'partial',
          lastError: null,
        }),
      }),
      {
        updatedAt: NOW,
      },
    );

    expect(next.coreProcessRunning).toBe(true);
    expect(next.startupStatus.phase).toBe('connecting');
    expect(next.startupStatus.updatedAt).toBe(NOW);
    expect(next.startupStatus.healthReason).toBe('partial-connectivity');
    expect(next.startupStatus.lastError).toBeNull();
  });
});
