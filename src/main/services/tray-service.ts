import { Menu, Tray, nativeImage } from 'electron';
import type { AppControlState } from '@/shared/contracts';
import { APP_NAME } from '../../shared/constants';

export interface TrayActions {
  showDashboard: () => void;
  showAlerts: () => void;
  showMarketOverview: () => void;
  showRulesSettings: () => void;
  setNotificationsEnabled: (enabled: boolean) => void | Promise<void>;
  startMonitoring: () => void | Promise<void>;
  stopMonitoring: () => void | Promise<void>;
  quitApp: () => void;
  getControlState: () => AppControlState;
}

const TRAY_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAM1BMVEUAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5dY' +
  '5AAAAA10Uk5TAAECAwQFBgcICQoLDA0ODxAREhMUWJ5LAAAASUlEQVQYV2Ng' +
  'YGBkYmBiYGRi5uXl4+Pn5OTk5eXk4+Pj4uLi4ODg39/f3Nzc29vb2NjY19fX' +
  '1NTU09PT0NDQz8/PwMDAwAAAc40G8WcA4wAAAABJRU5ErkJggg==';

const runTrayAction = (action: () => void | Promise<void>, afterAction: () => void): void => {
  void Promise.resolve()
    .then(action)
    .finally(afterAction);
};

export class AppTray {
  private tray: Tray | null = null;
  private actions: TrayActions | null = null;

  public create(actions: TrayActions): Tray {
    this.actions = actions;
    if (this.tray) {
      this.rebuildMenu();
      return this.tray;
    }

    const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_BASE64}`);
    this.tray = new Tray(icon);
    this.tray.setToolTip(APP_NAME);
    this.tray.on('double-click', actions.showDashboard);
    this.tray.on('click', actions.showDashboard);

    this.rebuildMenu();
    return this.tray;
  }

  public refresh(): void {
    this.rebuildMenu();
  }

  public destroy(): void {
    if (!this.tray) {
      return;
    }

    this.tray.destroy();
    this.tray = null;
    this.actions = null;
  }

  private rebuildMenu(): void {
    if (!this.tray || !this.actions) {
      return;
    }

    const actions = this.actions;
    const controlState = actions.getControlState();
    const monitoringRunning = controlState.coreProcessRunning;
    const menu = Menu.buildFromTemplate([
      { label: '打开监控总览', click: actions.showDashboard },
      { label: '打开告警中心', click: actions.showAlerts },
      { label: '打开市场总览', click: actions.showMarketOverview },
      { label: '打开规则与设置', click: actions.showRulesSettings },
      { type: 'separator' },
      {
        label: controlState.notificationsEnabled
          ? '通知提醒：开启中（点击关闭）'
          : '通知提醒：已关闭（点击开启）',
        type: 'checkbox',
        checked: controlState.notificationsEnabled,
        click: () => {
          const nextEnabled = !actions.getControlState().notificationsEnabled;
          runTrayAction(
            () => actions.setNotificationsEnabled(nextEnabled),
            () => this.rebuildMenu(),
          );
        },
      },
      {
        label: '启动监控',
        enabled: !monitoringRunning,
        click: () => {
          runTrayAction(actions.startMonitoring, () => this.rebuildMenu());
        },
      },
      {
        label: '暂停监控',
        enabled: monitoringRunning,
        click: () => {
          runTrayAction(actions.stopMonitoring, () => this.rebuildMenu());
        },
      },
      { type: 'separator' },
      { label: '完全退出应用（关闭后台）', click: actions.quitApp },
    ]);

    this.tray.setContextMenu(menu);
  }
}
