import { describe, expect, it } from 'vitest';

import type { AlertTriggeredEvent, RuntimeState } from '../../src/main/contracts/ipc';
import {
  AlertDispatchPolicy,
  isQuietHoursActive,
} from '../../src/main/services/alert-dispatch-policy';

const createRuntime = (overrides?: Partial<RuntimeState>): RuntimeState => ({
  health: {
    connected: true,
    mode: 'live',
    shardActive: 1,
    shardTotal: 1,
    subscribedTokens: 1,
    reconnects: 0,
    latencyMs: 100,
    droppedEvents: 0,
    lastSyncAt: new Date(0).toISOString(),
  },
  controlState: {
    notificationsEnabled: true,
    coreProcessRunning: true,
    startupStatus: {
      phase: 'ready',
      attempts: 1,
      maxAttempts: 2,
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
      selectedSoundProfileId: 'builtin-soft',
      quietHoursStart: '23:00',
      quietHoursEnd: '06:00',
    },
    soundProfiles: [],
  },
  ...overrides,
});

const createAlert = (overrides?: Partial<AlertTriggeredEvent>): AlertTriggeredEvent => ({
  id: 'alert-1',
  ruleId: 'rule-1',
  triggeredAt: new Date(0).toISOString(),
  cityKey: 'shanghai',
  marketId: 'market-1',
  tokenId: 'token-1',
  message: 'Test alert',
  severity: 'warning',
  acknowledged: false,
  source: 'realtime',
  ...overrides,
});

const createPolicy = (): AlertDispatchPolicy =>
  new AlertDispatchPolicy({
    burstWindowMs: 1_000,
    burstLimit: 2,
  });

describe('AlertDispatchPolicy', () => {
  it('suppresses startup and backfill alert sources before user-facing dispatch', () => {
    const policy = createPolicy();

    const plan = policy.resolve({
      runtime: createRuntime(),
      alert: createAlert({ source: 'startup-scan' }),
      windowState: { visible: false, focused: false },
      shutdownRequested: false,
      nowMs: Date.parse('2026-04-25T10:00:00.000Z'),
    });

    expect(plan.initialDecision).toEqual({
      allowed: false,
      reason: 'suppressed-source:startup-scan',
    });
    expect(plan.toastDecision.reason).toBe('suppressed-source:startup-scan');
  });

  it('keeps sound eligible while suppressing only the system toast in foreground', () => {
    const policy = createPolicy();

    const plan = policy.resolve({
      runtime: createRuntime(),
      alert: createAlert(),
      windowState: { visible: true, focused: true },
      shutdownRequested: false,
      nowMs: Date.parse('2026-04-25T10:00:00.000Z'),
    });

    expect(plan.initialDecision).toEqual({ allowed: true, reason: 'allowed' });
    expect(plan.toastDecision).toEqual({ allowed: false, reason: 'foreground-window' });
  });

  it('blocks dispatch during quiet hours, including windows that cross midnight', () => {
    expect(
      isQuietHoursActive(
        {
          quietHoursStart: '23:00',
          quietHoursEnd: '06:00',
        },
        new Date(2026, 3, 25, 0, 30),
      ),
    ).toBe(true);
    expect(
      isQuietHoursActive(
        {
          quietHoursStart: '23:00',
          quietHoursEnd: '06:00',
        },
        new Date(2026, 3, 25, 18, 0),
      ),
    ).toBe(false);
  });

  it('applies burst limiting only within the active notification window', () => {
    const policy = createPolicy();
    const runtime = createRuntime();
    const alert = createAlert();
    const windowState = { visible: false, focused: false };

    policy.recordNotification(1_000);
    policy.recordNotification(1_500);

    expect(
      policy.resolve({
        runtime,
        alert,
        windowState,
        shutdownRequested: false,
        nowMs: 1_600,
      }).initialDecision.reason,
    ).toBe('burst-limit');

    expect(
      policy.resolve({
        runtime,
        alert,
        windowState,
        shutdownRequested: false,
        nowMs: 2_100,
      }).initialDecision.reason,
    ).toBe('allowed');
  });

  it('resets burst state when dispatch is suspended and resumes cleanly', () => {
    const policy = createPolicy();
    policy.recordNotification(1_000);
    policy.recordNotification(1_500);

    expect(policy.suspend('monitor-stopping')).toBe(true);
    expect(policy.suspend('monitor-stopping')).toBe(false);
    expect(
      policy.resolve({
        runtime: createRuntime(),
        alert: createAlert(),
        windowState: { visible: false, focused: false },
        shutdownRequested: false,
        nowMs: 1_600,
      }).initialDecision.reason,
    ).toBe('dispatch-suspended:monitor-stopping');

    expect(policy.resume()).toBe(true);
    expect(policy.resume()).toBe(false);
    expect(
      policy.resolve({
        runtime: createRuntime(),
        alert: createAlert(),
        windowState: { visible: false, focused: false },
        shutdownRequested: false,
        nowMs: 1_600,
      }).initialDecision.reason,
    ).toBe('allowed');
  });
});
