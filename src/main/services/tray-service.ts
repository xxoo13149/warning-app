import { Menu, Tray, nativeImage } from 'electron';
import { APP_NAME } from '../../shared/constants';

export interface TrayActions {
  showMainWindow: () => void;
  quitApp: () => void;
}

const TRAY_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAM1BMVEUAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5dY' +
  '5AAAAA10Uk5TAAECAwQFBgcICQoLDA0ODxAREhMUWJ5LAAAASUlEQVQYV2Ng' +
  'YGBkYmBiYGRi5uXl4+Pn5OTk5eXk4+Pj4uLi4ODg39/f3Nzc29vb2NjY19fX' +
  '1NTU09PT0NDQz8/PwMDAwAAAc40G8WcA4wAAAABJRU5ErkJggg==';

export class AppTray {
  private tray: Tray | null = null;

  public create(actions: TrayActions): Tray {
    if (this.tray) {
      return this.tray;
    }

    const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_BASE64}`);
    this.tray = new Tray(icon);
    this.tray.setToolTip(APP_NAME);
    this.tray.on('double-click', actions.showMainWindow);
    this.tray.on('click', actions.showMainWindow);

    const menu = Menu.buildFromTemplate([
      { label: '打开监控总览', click: actions.showMainWindow },
      { type: 'separator' },
      { label: '退出应用', click: actions.quitApp },
    ]);

    this.tray.setContextMenu(menu);
    return this.tray;
  }

  public destroy(): void {
    if (!this.tray) {
      return;
    }

    this.tray.destroy();
    this.tray = null;
  }
}
