import { describe, expect, it } from 'vitest';

import type { AlertTriggeredEvent, RuntimeState } from '../../src/main/contracts/ipc';
import { resolveAlertSoundPlan } from '../../src/main/services/alert-sound';
import { BUILTIN_DEFAULT_SOUND_ID, toBuiltinSoundPath } from '../../src/shared/sound-library';

const createRuntime = (overrides?: Partial<RuntimeState>): RuntimeState => ({
  health: {
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
  },
  controlState: {
    notificationsEnabled: true,
    coreProcessRunning: true,
    startupStatus: {
      phase: 'ready',
      attempts: 1,
      maxAttempts: 1,
      startedAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      healthReason: null,
      lastError: null,
    },
  },
  settingsPayload: {
    settings: {
      startOnBoot: false,
      backgroundAudio: true,
      reconnectPolicy: 'balanced',
      pollIntervalSec: 60,
      tickRetentionDays: 7,
      alertRetentionDays: 90,
      selectedSoundProfileId: 'builtin-high-bell',
      quietHoursStart: '23:00',
      quietHoursEnd: '06:00',
    },
    soundProfiles: [
      {
        id: 'builtin-high-bell',
        name: '高音铃声',
        filePath: 'builtin:builtin-high-bell',
        gain: 0.74,
        enabled: true,
        isBuiltin: true,
        isDefault: true,
      },
      {
        id: BUILTIN_DEFAULT_SOUND_ID,
        name: '清脆短铃',
        filePath: toBuiltinSoundPath(BUILTIN_DEFAULT_SOUND_ID),
        gain: 0.62,
        enabled: true,
        isBuiltin: true,
        isDefault: false,
      },
    ],
  },
  ...overrides,
});

const createAlert = (overrides?: Partial<AlertTriggeredEvent>): AlertTriggeredEvent => ({
  id: 'alert-1',
  ruleId: 'rule-1',
  triggeredAt: new Date().toISOString(),
  cityKey: 'shanghai',
  marketId: 'market-1',
  tokenId: 'token-1',
  message: '测试告警',
  severity: 'warning',
  acknowledged: false,
  ...overrides,
});

describe('resolveAlertSoundPlan', () => {
  it('keeps notifications silent when background audio is disabled', () => {
    const runtime = createRuntime({
      settingsPayload: {
        ...createRuntime().settingsPayload,
        settings: {
          ...createRuntime().settingsPayload.settings,
          backgroundAudio: false,
        },
      },
    });

    const plan = resolveAlertSoundPlan(runtime, createAlert());

    expect(plan.shouldAttemptPlayback).toBe(false);
    expect(plan.notificationSilentByDefault).toBe(true);
  });

  it('uses the preferred alert sound when it is available', () => {
    const runtime = createRuntime();

    const plan = resolveAlertSoundPlan(runtime, createAlert({
      id: 'alert-2',
      ruleId: 'rule-2',
      cityKey: 'beijing',
      marketId: 'market-2',
      tokenId: 'token-2',
      soundProfileId: 'builtin-high-bell',
    }));

    expect(plan.shouldAttemptPlayback).toBe(true);
    expect(plan.filePath).toBe('builtin:builtin-high-bell');
    expect(plan.gain).toBe(0.74);
    expect(plan.notificationSilentByDefault).toBe(false);
  });

  it('falls back to the built-in default sound when profiles are missing', () => {
    const runtime = createRuntime({
      settingsPayload: {
        ...createRuntime().settingsPayload,
        soundProfiles: [],
      },
    });

    const plan = resolveAlertSoundPlan(runtime, createAlert({
      id: 'alert-3',
      ruleId: 'rule-3',
      cityKey: 'guangzhou',
      marketId: 'market-3',
      tokenId: 'token-3',
    }));

    expect(plan.filePath).toBe(toBuiltinSoundPath(BUILTIN_DEFAULT_SOUND_ID));
    expect(plan.gain).toBeGreaterThan(0);
  });
});
