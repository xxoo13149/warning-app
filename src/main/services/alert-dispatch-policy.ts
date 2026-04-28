import type { AlertTriggeredEvent, RuntimeState } from '../contracts/ipc';

export interface AlertDispatchDecision {
  allowed: boolean;
  reason: string;
}

export interface AlertWindowState {
  visible: boolean;
  focused: boolean;
}

interface AlertDispatchPolicyOptions {
  burstWindowMs: number;
  burstLimit: number;
}

interface ResolveAlertDispatchInput {
  runtime: RuntimeState;
  alert: AlertTriggeredEvent;
  windowState: AlertWindowState;
  shutdownRequested: boolean;
  nowMs?: number;
}

export interface AlertDispatchPlan {
  initialDecision: AlertDispatchDecision;
  toastDecision: AlertDispatchDecision;
  quietHoursActive: boolean;
}

const SUPPRESSED_ALERT_SOURCES = new Set<AlertTriggeredEvent['source']>([
  'startup-scan',
  'rules-save-scan',
  'discovery-seed',
  'snapshot-backfill',
]);

export const parseClockTimeToMinutes = (value: string): number | null => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
};

export const isQuietHoursActive = (
  settings: Pick<RuntimeState['settingsPayload']['settings'], 'quietHoursStart' | 'quietHoursEnd'>,
  now = new Date(),
): boolean => {
  const start = parseClockTimeToMinutes(settings.quietHoursStart);
  const end = parseClockTimeToMinutes(settings.quietHoursEnd);
  if (start === null || end === null) {
    return false;
  }
  if (start === end) {
    return true;
  }

  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
};

export class AlertDispatchPolicy {
  private readonly burstWindowMs: number;
  private readonly burstLimit: number;
  private readonly recentNotificationAt: number[] = [];
  private suspended = false;
  private suspendedReason: string | null = null;

  public constructor(options: AlertDispatchPolicyOptions) {
    this.burstWindowMs = options.burstWindowMs;
    this.burstLimit = options.burstLimit;
  }

  public suspend(reason: string): boolean {
    const previousReason = this.suspendedReason;
    this.suspended = true;
    this.suspendedReason = reason;
    this.recentNotificationAt.length = 0;
    return previousReason !== reason;
  }

  public resume(): boolean {
    if (!this.suspended && this.suspendedReason === null) {
      return false;
    }
    this.suspended = false;
    this.suspendedReason = null;
    return true;
  }

  public recordNotification(nowMs = Date.now()): void {
    this.recentNotificationAt.push(nowMs);
  }

  public countRecentNotifications(nowMs = Date.now()): number {
    const cutoff = nowMs - this.burstWindowMs;
    while (
      this.recentNotificationAt.length > 0 &&
      this.recentNotificationAt[0] !== undefined &&
      this.recentNotificationAt[0] < cutoff
    ) {
      this.recentNotificationAt.shift();
    }
    return this.recentNotificationAt.length;
  }

  public resolve(input: ResolveAlertDispatchInput): AlertDispatchPlan {
    const nowMs = input.nowMs ?? Date.now();
    const quietHoursActive = isQuietHoursActive(
      input.runtime.settingsPayload.settings,
      new Date(nowMs),
    );
    const initialDecision = this.resolveInitialDecision({
      ...input,
      quietHoursActive,
      nowMs,
    });
    const toastDecision =
      initialDecision.allowed && shouldSuppressSystemNotificationInForeground(input.windowState)
        ? {
            allowed: false,
            reason: 'foreground-window',
          }
        : initialDecision;

    return {
      initialDecision,
      toastDecision,
      quietHoursActive,
    };
  }

  private resolveInitialDecision(
    input: ResolveAlertDispatchInput & {
      quietHoursActive: boolean;
      nowMs: number;
    },
  ): AlertDispatchDecision {
    if (input.shutdownRequested) {
      return {
        allowed: false,
        reason: 'shutdown',
      };
    }
    if (this.suspended) {
      return {
        allowed: false,
        reason: this.suspendedReason
          ? `dispatch-suspended:${this.suspendedReason}`
          : 'dispatch-suspended',
      };
    }
    if (SUPPRESSED_ALERT_SOURCES.has(input.alert.source)) {
      return {
        allowed: false,
        reason: `suppressed-source:${input.alert.source}`,
      };
    }
    if (!input.runtime.controlState.notificationsEnabled) {
      return {
        allowed: false,
        reason: 'disabled',
      };
    }
    if (input.quietHoursActive) {
      return {
        allowed: false,
        reason: 'quiet-hours',
      };
    }
    if (this.countRecentNotifications(input.nowMs) >= this.burstLimit) {
      return {
        allowed: false,
        reason: 'burst-limit',
      };
    }
    return {
      allowed: true,
      reason: 'allowed',
    };
  }
}

export const shouldSuppressSystemNotificationInForeground = (
  windowState: Pick<AlertWindowState, 'visible'>,
): boolean => windowState.visible;
