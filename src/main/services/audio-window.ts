import { BrowserWindow } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { BUILTIN_SOUND_PATH_PREFIX } from '../../shared/sound-library';

const AUDIO_WINDOW_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>audio-host</title>
  </head>
  <body>
    <script>
      let activeAudio = null;
      let activeContext = null;
      const builtinPrefix = "builtin:";
      const builtinPatterns = {
        "builtin-tick-soft": [{ frequency: 880, start: 0, duration: 0.08, type: "sine" }],
        "builtin-sonar-soft": [{ frequency: 520, start: 0, duration: 0.18, type: "sine" }],
        "builtin-chime-short": [{ frequency: 740, start: 0, duration: 0.1, type: "triangle" }],
        "builtin-double-ding": [
          { frequency: 660, start: 0, duration: 0.09, type: "triangle" },
          { frequency: 880, start: 0.12, duration: 0.11, type: "triangle" },
        ],
        "builtin-high-bell": [
          { frequency: 1046.5, start: 0, duration: 0.12, type: "sine" },
          { frequency: 1568, start: 0.04, duration: 0.14, type: "sine", gain: 0.55 },
        ],
        "builtin-critical-siren": [
          { frequency: 620, start: 0, duration: 0.16, type: "sawtooth" },
          { frequency: 920, start: 0.18, duration: 0.18, type: "sawtooth" },
          { frequency: 620, start: 0.38, duration: 0.16, type: "sawtooth" },
        ],
      };

      function getAudioContextClass() {
        return window.AudioContext || window.webkitAudioContext || null;
      }

      async function stopActiveSound() {
        if (activeAudio) {
          activeAudio.pause();
          activeAudio.currentTime = 0;
          activeAudio = null;
        }
        if (activeContext) {
          await activeContext.close().catch(() => undefined);
          activeContext = null;
        }
      }

      window.__playBuiltinSound = async function __playBuiltinSound(id, gain) {
        try {
          await stopActiveSound();
          const AudioContextClass = getAudioContextClass();
          if (!AudioContextClass) {
            return false;
          }

          const pattern = builtinPatterns[id] || builtinPatterns["builtin-chime-short"];
          const context = new AudioContextClass();
          activeContext = context;
          if (context.state === "suspended") {
            await context.resume();
          }
          const master = context.createGain();
          master.gain.value = Math.max(0.05, Math.min(typeof gain === "number" ? gain : 1, 1));
          master.connect(context.destination);
          const startedAt = context.currentTime + 0.03;
          let totalDuration = 0.2;

          for (const note of pattern) {
            const oscillator = context.createOscillator();
            const envelope = context.createGain();
            const start = startedAt + note.start;
            const duration = note.duration;
            const noteGain = typeof note.gain === "number" ? note.gain : 1;
            totalDuration = Math.max(totalDuration, note.start + duration + 0.12);

            oscillator.type = note.type;
            oscillator.frequency.setValueAtTime(note.frequency, start);
            envelope.gain.setValueAtTime(0.0001, start);
            envelope.gain.exponentialRampToValueAtTime(0.35 * noteGain, start + 0.012);
            envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
            oscillator.connect(envelope);
            envelope.connect(master);
            oscillator.start(start);
            oscillator.stop(start + duration + 0.03);
          }

          window.setTimeout(() => {
            if (activeContext === context) {
              void context.close().catch(() => undefined);
              activeContext = null;
            }
          }, Math.ceil(totalDuration * 1000));

          return true;
        } catch (error) {
          console.error("Builtin audio playback failed", error);
          return false;
        }
      };

      window.__playSound = async function __playSound(src, gain) {
        try {
          if (typeof src === "string" && src.startsWith(builtinPrefix)) {
            return window.__playBuiltinSound(src.slice(builtinPrefix.length), gain);
          }
          await stopActiveSound();
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

    const src = filePath.startsWith(BUILTIN_SOUND_PATH_PREFIX)
      ? filePath
      : pathToFileURL(path.normalize(filePath)).toString();
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
