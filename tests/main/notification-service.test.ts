import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockNotificationInstance = {
  show: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
};

const {
  createdNotifications,
  notificationCtorMock,
  notificationShowMock,
  isSupportedMock,
} = vi.hoisted(() => {
  const createdNotifications: MockNotificationInstance[] = [];
  const notificationShowMock = vi.fn();
  const isSupportedMock = vi.fn(() => true);
  const notificationCtorMock = vi.fn().mockImplementation(() => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const instance: MockNotificationInstance = {
      show: notificationShowMock,
      close: vi.fn(),
      once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
      }),
      emit: (event: string, ...args: unknown[]) => {
        listeners.get(event)?.(...args);
      },
    };
    createdNotifications.push(instance);
    return instance;
  });
  Object.assign(notificationCtorMock, {
    isSupported: isSupportedMock,
  });

  return {
    createdNotifications,
    notificationCtorMock,
    notificationShowMock,
    isSupportedMock,
  };
});

vi.mock('electron', () => ({
  Notification: notificationCtorMock,
}));

import { ElectronNotificationService } from '../../src/main/services/notification-service';

describe('ElectronNotificationService', () => {
  beforeEach(() => {
    createdNotifications.length = 0;
    notificationCtorMock.mockClear();
    notificationShowMock.mockClear();
    isSupportedMock.mockReset();
    isSupportedMock.mockReturnValue(true);
  });

  it('does not force silent notifications by default', () => {
    const service = new ElectronNotificationService();

    service.notify('Weather Monitor', 'Test notification');

    expect(notificationCtorMock).toHaveBeenCalledTimes(1);
    expect(notificationCtorMock.mock.calls[0]?.[0]).toMatchObject({
      title: 'Weather Monitor',
      body: 'Test notification',
      urgency: 'normal',
    });
    expect(notificationCtorMock.mock.calls[0]?.[0]?.silent).toBeUndefined();
    expect(notificationShowMock).toHaveBeenCalledTimes(1);
  });

  it('keeps notifications silent when explicit app-audio playback has succeeded', () => {
    const service = new ElectronNotificationService();

    service.notify('Weather Monitor', 'Test notification', { silent: true });

    expect(notificationCtorMock.mock.calls[0]?.[0]).toMatchObject({
      title: 'Weather Monitor',
      body: 'Test notification',
      urgency: 'normal',
      silent: true,
    });
  });

  it('closes active notifications when notifications are disabled', () => {
    const service = new ElectronNotificationService();

    service.notify('Weather Monitor', 'Test notification');
    service.setEnabled(false);

    expect(createdNotifications).toHaveLength(1);
    expect(createdNotifications[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('destroy closes active notifications and blocks future notifications', () => {
    const service = new ElectronNotificationService();

    service.notify('Weather Monitor', 'Test notification');
    service.destroy();
    service.setEnabled(true);
    service.notify('Weather Monitor', 'After destroy');

    expect(createdNotifications).toHaveLength(1);
    expect(createdNotifications[0]?.close).toHaveBeenCalledTimes(1);
    expect(notificationCtorMock).toHaveBeenCalledTimes(1);
  });

  it('retains closed Windows notifications until shutdown cleanup runs', () => {
    const service = new ElectronNotificationService({ platform: 'win32' });

    service.notify('Weather Monitor', 'Test notification');
    createdNotifications[0]?.emit('close');
    service.setEnabled(false);

    expect(createdNotifications[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('drops closed non-Windows notifications immediately', () => {
    const service = new ElectronNotificationService({ platform: 'linux' });

    service.notify('Weather Monitor', 'Test notification');
    createdNotifications[0]?.emit('close');
    service.setEnabled(false);

    expect(createdNotifications[0]?.close).toHaveBeenCalledTimes(0);
  });

  it('does not throw when the OS notification constructor fails', () => {
    const log = vi.fn();
    notificationCtorMock.mockImplementationOnce(() => {
      throw new Error('constructor failed');
    });
    const service = new ElectronNotificationService({ log });

    expect(() => service.notify('Weather Monitor', 'Test notification')).not.toThrow();

    expect(createdNotifications).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"phase":"construct-failed"'),
      expect.any(Error),
    );
  });

  it('does not retain an active notification when show throws', () => {
    const log = vi.fn();
    notificationShowMock.mockImplementationOnce(() => {
      throw new Error('show failed');
    });
    const service = new ElectronNotificationService({ log });

    expect(() => service.notify('Weather Monitor', 'Test notification')).not.toThrow();
    service.setEnabled(false);

    expect(createdNotifications).toHaveLength(1);
    expect(createdNotifications[0]?.close).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"phase":"show-failed"'),
      expect.any(Error),
    );
  });

  it('invokes click callbacks with notification and alert context', () => {
    const service = new ElectronNotificationService();
    const onClick = vi.fn();
    const alert = {
      id: 'alert-1',
      ruleId: 'rule-1',
      source: 'realtime',
      severity: 'warning',
      triggeredAt: '2026-04-25T00:00:00.000Z',
      cityKey: 'nyc',
      marketId: 'market-1',
      tokenId: 'token-1',
      message: 'Rain risk moved',
      acknowledged: false,
    } as Parameters<ElectronNotificationService['notifyAlert']>[0];

    service.notifyAlert(alert, { onClick });
    createdNotifications[0]?.emit('click');

    expect(onClick).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationId: 'notification-1',
        alertId: 'alert-1',
        source: 'realtime',
        alert,
      }),
    );
  });
});
