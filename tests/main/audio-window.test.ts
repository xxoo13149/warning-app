import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  browserWindowMock,
  executeJavaScriptMock,
  shellBeepMock,
} = vi.hoisted(() => {
  const executeJavaScriptMock = vi.fn();
  const shellBeepMock = vi.fn();

  const browserWindowMock = vi.fn().mockImplementation(() => ({
    isDestroyed: () => false,
    setMenuBarVisibility: vi.fn(),
    once: vi.fn(),
    destroy: vi.fn(),
    loadURL: vi.fn(),
    webContents: {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      once: vi.fn((event: string, listener: () => void) => {
        if (event === 'did-finish-load') {
          listener();
        }
      }),
      executeJavaScript: executeJavaScriptMock,
    },
  }));

  return {
    browserWindowMock,
    executeJavaScriptMock,
    shellBeepMock,
  };
});

vi.mock('electron', () => ({
  BrowserWindow: browserWindowMock,
  shell: {
    beep: shellBeepMock,
  },
}));

import { HiddenAudioWindow } from '../../src/main/services/audio-window';

describe('HiddenAudioWindow preview fallback', () => {
  beforeEach(() => {
    browserWindowMock.mockClear();
    executeJavaScriptMock.mockReset();
    shellBeepMock.mockClear();
  });

  it('returns direct playback success when audio script succeeds', async () => {
    executeJavaScriptMock.mockResolvedValueOnce(true);

    const window = new HiddenAudioWindow();
    const result = await window.previewFromPath('builtin:builtin-chime-short', 0.6);

    expect(result).toEqual({ played: true });
    expect(shellBeepMock).not.toHaveBeenCalled();
  });

  it('falls back to system beep when direct playback fails', async () => {
    executeJavaScriptMock.mockResolvedValueOnce(false);

    const window = new HiddenAudioWindow();
    const result = await window.previewFromPath('builtin:builtin-chime-short', 0.6);

    expect(result).toEqual({ played: true, fallback: 'system-beep' });
    expect(shellBeepMock).toHaveBeenCalledTimes(1);
  });
});
