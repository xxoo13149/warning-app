import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppControlState } from '../../src/shared/contracts';

type MockMenuItem = {
  label?: string;
  type?: string;
  checked?: boolean;
  enabled?: boolean;
  click?: (menuItem: { checked: boolean }) => void;
};

type MockTrayInstance = {
  setToolTip: ReturnType<typeof vi.fn>;
  setContextMenu: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  emit: (event: string) => void;
};

const { trayInstances, buildFromTemplateMock, createFromDataUrlMock, trayCtorMock } =
  vi.hoisted(() => {
  const trayInstances: MockTrayInstance[] = [];
  const buildFromTemplateMock = vi.fn((template: MockMenuItem[]) => template);
  const createFromDataUrlMock = vi.fn((value: string) => ({ value }));
  const trayCtorMock = vi.fn().mockImplementation(() => {
    const handlers = new Map<string, () => void>();
    const instance: MockTrayInstance = {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        handlers.set(event, handler);
      }),
      emit: (event: string) => {
        handlers.get(event)?.();
      },
    };
    trayInstances.push(instance);
    return instance;
  });

  return {
    trayInstances,
    buildFromTemplateMock,
    createFromDataUrlMock,
    trayCtorMock,
  };
  });

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: buildFromTemplateMock,
  },
  Tray: trayCtorMock,
  nativeImage: {
    createFromDataURL: createFromDataUrlMock,
  },
}));

import { AppTray, type TrayActions } from '../../src/main/services/tray-service';

const buildControlState = (overrides: Partial<AppControlState> = {}): AppControlState => ({
  notificationsEnabled: true,
  coreProcessRunning: true,
  startupStatus: {
    phase: 'ready',
    attempts: 1,
    maxAttempts: 2,
    startedAt: '2026-04-25T00:00:00.000Z',
    updatedAt: '2026-04-25T00:00:00.000Z',
    healthReason: null,
    lastError: null,
  },
  ...overrides,
});

describe('AppTray', () => {
  let controlState: AppControlState;
  let actions: TrayActions;

  beforeEach(() => {
    trayInstances.length = 0;
    buildFromTemplateMock.mockClear();
    createFromDataUrlMock.mockClear();
    trayCtorMock.mockClear();
    controlState = buildControlState();
    actions = {
      showDashboard: vi.fn(),
      showAlerts: vi.fn(),
      showMarketOverview: vi.fn(),
      showRulesSettings: vi.fn(),
      setNotificationsEnabled: vi.fn(),
      startMonitoring: vi.fn(),
      stopMonitoring: vi.fn(),
      quitApp: vi.fn(),
      getControlState: () => controlState,
    };
  });

  it('opens the dashboard on tray click and double click', () => {
    const tray = new AppTray();

    tray.create(actions);
    trayInstances[0]?.emit('click');
    trayInstances[0]?.emit('double-click');

    expect(actions.showDashboard).toHaveBeenCalledTimes(2);
  });

  it('builds a Chinese product menu with explicit full exit wording', () => {
    const tray = new AppTray();

    tray.create(actions);

    const template = buildFromTemplateMock.mock.calls[0]?.[0] as MockMenuItem[];
    expect(template.map((item) => item.label).filter(Boolean)).toEqual([
      '打开监控总览',
      '打开告警中心',
      '打开市场总览',
      '打开规则与设置',
      '通知提醒：开启中（点击关闭）',
      '启动监控',
      '暂停监控',
      '完全退出应用（关闭后台）',
    ]);

    template.find((item) => item.label === '完全退出应用（关闭后台）')?.click?.({ checked: false });
    expect(actions.quitApp).toHaveBeenCalledTimes(1);
  });

  it('toggles notifications from the tray menu using the current app state', async () => {
    const tray = new AppTray();

    tray.create(actions);

    const template = buildFromTemplateMock.mock.calls[0]?.[0] as MockMenuItem[];
    template
      .find((item) => item.label === '通知提醒：开启中（点击关闭）')
      ?.click?.({ checked: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(actions.setNotificationsEnabled).toHaveBeenCalledWith(false);
  });
});
