import { BrowserWindow } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const AUDIO_WINDOW_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>audio-host</title>
  </head>
  <body>
    <script>
      let activeAudio = null;
      window.__playSound = async function __playSound(src, gain) {
        try {
          if (activeAudio) {
            activeAudio.pause();
            activeAudio.currentTime = 0;
          }
          activeAudio = new Audio(src);
          activeAudio.preload = "auto";
          if (typeof gain === "number" && Number.isFinite(gain)) {
            activeAudio.volume = Math.max(0, Math.min(gain, 1));
          }
          await activeAudio.play();
          return true;
        } catch (error) {
          console.error("Audio playback failed", error);
          return false;
        }
      };
    </script>
  </body>
</html>`;

export class HiddenAudioWindow {
  private audioWindow: BrowserWindow | null = null;

  private isReady = false;

  public create(): BrowserWindow {
    if (this.audioWindow && !this.audioWindow.isDestroyed()) {
      return this.audioWindow;
    }

    this.audioWindow = new BrowserWindow({
      width: 320,
      height: 240,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    this.audioWindow.setMenuBarVisibility(false);
    this.audioWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.audioWindow.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });
    this.audioWindow.once('closed', () => {
      this.audioWindow = null;
      this.isReady = false;
    });

    void this.audioWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(AUDIO_WINDOW_HTML)}`);
    this.audioWindow.webContents.once('did-finish-load', () => {
      this.isReady = true;
    });

    return this.audioWindow;
  }

  public async playFromPath(filePath: string, gain = 1): Promise<boolean> {
    if (!filePath) {
      return false;
    }

    const audioWindow = this.create();
    await this.ensureReady(audioWindow);

    const normalizedPath = path.normalize(filePath);
    const src = pathToFileURL(normalizedPath).toString();
    const invocation = `window.__playSound(${JSON.stringify(src)}, ${JSON.stringify(
      Math.max(0, Math.min(gain, 1)),
    )});`;

    try {
      const played = await audioWindow.webContents.executeJavaScript(invocation, true);
      return Boolean(played);
    } catch {
      return false;
    }
  }

  public destroy(): void {
    if (!this.audioWindow || this.audioWindow.isDestroyed()) {
      return;
    }

    this.audioWindow.destroy();
    this.audioWindow = null;
    this.isReady = false;
  }

  private async ensureReady(audioWindow: BrowserWindow): Promise<void> {
    if (this.isReady) {
      return;
    }

    await new Promise<void>((resolve) => {
      if (this.isReady) {
        resolve();
        return;
      }

      const listener = () => {
        this.isReady = true;
        resolve();
      };

      audioWindow.webContents.once('did-finish-load', listener);
    });
  }
}
