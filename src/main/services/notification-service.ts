import { Notification } from 'electron';

import { buildAlertNotificationContent } from '../../shared/alert-presentation';
import type { AlertTriggeredEvent } from '../contracts/ipc';

const RETAIN_CLOSED_NOTIFICATIONS_MS = 10 * 60 * 1000;
const MAX_RETAINED_NOTIFICATIONS = 256;

export interface NotificationDispatchOptions {
  silent?: boolean;
  alertId?: string;
  source?: AlertTriggeredEvent['source'];
  alert?: AlertTriggeredEvent;
  onClick?: (context: NotificationClickContext) => void;
}

export interface NotificationClickContext {
  notificationId: string;
  title: string;
  body: string;
  alertId?: string;
  source?: AlertTriggeredEvent['source'];
  alert?: AlertTriggeredEvent;
}

export interface NotificationService {
  notify(title: string, body: string, options?: NotificationDispatchOptions): void;
  notifyAlert(alert: AlertTriggeredEvent, options?: NotificationDispatchOptions): void;
  closeAll(): void;
  destroy(): void;
}

interface NotificationEntry {
  id: string;
  notification: Notification;
  createdAt: number;
  retainUntil?: number;
}

interface ElectronNotificationServiceOptions {
  log?: (message: string, error?: unknown) => void;
  platform?: NodeJS.Platform;
}

export class ElectronNotificationService implements NotificationService {
  private enabled = true;
  private destroyed = false;
  private sequence = 0;
  private readonly activeNotifications = new Map<Notification, NotificationEntry>();
  private readonly log?: (message: string, error?: unknown) => void;
  private readonly platform: NodeJS.Platform;

  public constructor(options: ElectronNotificationServiceOptions = {}) {
    this.log = options.log;
    this.platform = options.platform ?? process.platform;
  }

  public setEnabled(enabled: boolean): void {
    if (this.destroyed) {
      this.logEvent('notification.enabled_ignored', {
        enabled,
        reason: 'destroyed',
      });
      return;
    }
    this.enabled = enabled;
    this.logEvent('notification.enabled', { enabled });
    if (!enabled) {
      this.closeAll();
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public notify(title: string, body: string, options?: NotificationDispatchOptions): void {
    this.pruneRetainedNotifications();

    if (this.destroyed || !this.enabled) {
      this.logEvent('notification.skipped', {
        reason: this.destroyed ? 'destroyed' : 'disabled',
        alertId: options?.alertId ?? null,
        source: options?.source ?? null,
      });
      return;
    }

    if (!Notification.isSupported()) {
      this.logEvent('notification.skipped', {
        reason: 'unsupported',
        alertId: options?.alertId ?? null,
        source: options?.source ?? null,
      });
      return;
    }

    const notificationOptions = {
      title,
      body,
      urgency: 'normal',
      ...(options?.silent ? { silent: true } : {}),
    } as const;

    let notification: Notification;
    try {
      notification = new Notification(notificationOptions);
    } catch (error) {
      this.logEvent(
        'notification.lifecycle',
        {
          alertId: options?.alertId ?? null,
          source: options?.source ?? null,
          phase: 'construct-failed',
        },
        error,
      );
      return;
    }

    const entry: NotificationEntry = {
      id: `notification-${++this.sequence}`,
      notification,
      createdAt: Date.now(),
    };

    this.activeNotifications.set(notification, entry);
    notification.once('show', () => {
      this.logEvent('notification.lifecycle', {
        notificationId: entry.id,
        alertId: options?.alertId ?? null,
        source: options?.source ?? null,
        phase: 'show',
        activeCount: this.activeNotifications.size,
      });
    });
    notification.once('close', () => {
      const current = this.activeNotifications.get(notification);
      if (!current) {
        return;
      }
      if (this.platform === 'win32') {
        current.retainUntil = Date.now() + RETAIN_CLOSED_NOTIFICATIONS_MS;
      } else {
        this.activeNotifications.delete(notification);
      }
      this.logEvent('notification.lifecycle', {
        notificationId: current.id,
        alertId: options?.alertId ?? null,
        source: options?.source ?? null,
        phase: 'close',
        retained: this.platform === 'win32',
        activeCount: this.activeNotifications.size,
      });
    });
    notification.once('failed', (error) => {
      const current = this.activeNotifications.get(notification);
      if (current) {
        this.activeNotifications.delete(notification);
      }
      this.logEvent(
        'notification.lifecycle',
        {
          notificationId: current?.id ?? entry.id,
          alertId: options?.alertId ?? null,
          source: options?.source ?? null,
          phase: 'failed',
          activeCount: this.activeNotifications.size,
        },
        error,
      );
    });
    notification.once('click', () => {
      const current = this.activeNotifications.get(notification);
      if (current) {
        this.activeNotifications.delete(notification);
      }
      const notificationId = current?.id ?? entry.id;
      this.logEvent('notification.lifecycle', {
        notificationId,
        alertId: options?.alertId ?? null,
        source: options?.source ?? null,
        phase: 'click',
        activeCount: this.activeNotifications.size,
      });
      try {
        options?.onClick?.({
          notificationId,
          title,
          body,
          alertId: options?.alertId,
          source: options?.source,
          alert: options?.alert,
        });
      } catch (error) {
        this.logEvent(
          'notification.lifecycle',
          {
            notificationId,
            alertId: options?.alertId ?? null,
            source: options?.source ?? null,
            phase: 'click-handler-failed',
            activeCount: this.activeNotifications.size,
          },
          error,
        );
      }
    });

    this.logEvent('notification.show_attempt', {
      notificationId: entry.id,
      alertId: options?.alertId ?? null,
      source: options?.source ?? null,
      silent: Boolean(options?.silent),
      title,
      bodyLength: body.length,
      activeCount: this.activeNotifications.size,
    });
    try {
      notification.show();
    } catch (error) {
      this.activeNotifications.delete(notification);
      this.logEvent(
        'notification.lifecycle',
        {
          notificationId: entry.id,
          alertId: options?.alertId ?? null,
          source: options?.source ?? null,
          phase: 'show-failed',
          activeCount: this.activeNotifications.size,
        },
        error,
      );
    }
  }

  public notifyAlert(alert: AlertTriggeredEvent, options?: NotificationDispatchOptions): void {
    const notification = buildAlertNotificationContent(alert);
    this.notify(notification.title, notification.body, {
      ...options,
      alertId: options?.alertId ?? alert.id,
      source: options?.source ?? alert.source,
      alert,
    });
  }

  public closeAll(): void {
    this.pruneRetainedNotifications();
    this.logEvent('notification.close_all.begin', {
      activeCount: this.activeNotifications.size,
    });

    for (const entry of this.activeNotifications.values()) {
      try {
        entry.notification.close();
        this.logEvent('notification.close_request', {
          notificationId: entry.id,
        });
      } catch (error) {
        this.logEvent(
          'notification.close_request_failed',
          {
            notificationId: entry.id,
          },
          error,
        );
      }
    }

    this.activeNotifications.clear();
    this.logEvent('notification.close_all.end', {
      activeCount: this.activeNotifications.size,
    });
  }

  public destroy(): void {
    this.destroyed = true;
    this.enabled = false;
    this.logEvent('notification.destroy');
    this.closeAll();
  }

  private pruneRetainedNotifications(): void {
    const now = Date.now();
    const retainedEntries: NotificationEntry[] = [];

    for (const [notification, entry] of this.activeNotifications.entries()) {
      if (entry.retainUntil !== undefined && entry.retainUntil <= now) {
        this.activeNotifications.delete(notification);
        continue;
      }
      if (entry.retainUntil !== undefined) {
        retainedEntries.push(entry);
      }
    }

    if (retainedEntries.length <= MAX_RETAINED_NOTIFICATIONS) {
      return;
    }

    const overflow = retainedEntries
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(0, retainedEntries.length - MAX_RETAINED_NOTIFICATIONS);

    for (const entry of overflow) {
      this.activeNotifications.delete(entry.notification);
    }
  }

  private logEvent(
    event: string,
    details?: Record<string, unknown>,
    error?: unknown,
  ): void {
    if (!this.log) {
      return;
    }
    this.log(
      JSON.stringify({
        event,
        ...(details ?? {}),
      }),
      error,
    );
  }
}
