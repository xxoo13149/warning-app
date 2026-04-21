import { Notification } from 'electron';

import type { AlertTriggeredEvent } from '../contracts/ipc';

export interface NotificationService {
  notify(title: string, body: string): void;
  notifyAlert(alert: AlertTriggeredEvent): void;
}

export class ElectronNotificationService implements NotificationService {
  private enabled = true;

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public notify(title: string, body: string): void {
    if (!this.enabled) {
      return;
    }

    if (!Notification.isSupported()) {
      return;
    }

    const notification = new Notification({
      title,
      body,
      urgency: 'normal',
      silent: true,
    });

    notification.show();
  }

  public notifyAlert(alert: AlertTriggeredEvent): void {
    const title =
      alert.severity === 'critical'
        ? 'Polymarket 天气监控 · 关键告警'
        : alert.severity === 'warning'
          ? 'Polymarket 天气监控 · 警告'
          : 'Polymarket 天气监控 · 提示';
    this.notify(title, alert.message);
  }
}
