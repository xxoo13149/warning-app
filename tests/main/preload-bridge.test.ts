import { beforeEach, describe, expect, it, vi } from 'vitest';

const { exposeInMainWorldMock, ipcInvokeMock } = vi.hoisted(() => ({
  exposeInMainWorldMock: vi.fn(),
  ipcInvokeMock: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: exposeInMainWorldMock,
  },
  ipcRenderer: {
    invoke: ipcInvokeMock,
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

import {
  exposePreloadBridge,
  sampleAndReportRendererMemoryTelemetry,
  startRendererMemoryTelemetryReporter,
} from '../../src/main/preload-bridge';

describe('preload bridge memory telemetry', () => {
  beforeEach(() => {
    exposeInMainWorldMock.mockReset();
    ipcInvokeMock.mockReset();
  });

  it('samples renderer memory and reports it through the internal telemetry IPC', async () => {
    ipcInvokeMock.mockResolvedValue({ ok: true });

    const result = await sampleAndReportRendererMemoryTelemetry({
      now: () => new Date('2026-04-28T09:15:00.000Z'),
      getPid: () => 4321,
      getProcessMemoryInfo: async () => ({
        private: 172_000,
        residentSet: 193_000,
        shared: 16_000,
      }),
      getBlinkMemoryInfo: () => ({
        allocated: 86_000,
        total: 104_000,
      }),
      getVisibilityState: () => 'visible',
      isHidden: () => false,
    });

    expect(result).toEqual({
      sampledAt: '2026-04-28T09:15:00.000Z',
      pid: 4321,
      hidden: false,
      visibilityState: 'visible',
      processMemory: {
        privateKb: 172_000,
        residentSetKb: 193_000,
        sharedKb: 16_000,
      },
      blinkMemory: {
        allocatedKb: 86_000,
        totalKb: 104_000,
      },
    });
    expect(ipcInvokeMock).toHaveBeenCalledWith('telemetry.memory.report', result);
  });

  it('starts a periodic reporter and wires a visibility refresh hook', async () => {
    ipcInvokeMock.mockResolvedValue({ ok: true });
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const clearInterval = vi.fn();
    let intervalHandler: (() => void) | null = null;
    const setInterval = vi.fn((handler: () => void) => {
      intervalHandler = handler;
      return 123 as unknown as ReturnType<typeof globalThis.setInterval>;
    });

    const stop = startRendererMemoryTelemetryReporter({
      now: () => new Date('2026-04-28T09:20:00.000Z'),
      getPid: () => 99,
      getProcessMemoryInfo: async () => ({
        private: 1,
        residentSet: 2,
        shared: 3,
      }),
      getBlinkMemoryInfo: () => ({
        allocated: 4,
        total: 5,
      }),
      getVisibilityState: () => 'hidden',
      isHidden: () => true,
      setInterval,
      clearInterval,
      addEventListener,
      removeEventListener,
    });

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 30_000);
    expect(addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(ipcInvokeMock).toHaveBeenCalledTimes(1);

    const registeredIntervalHandler = intervalHandler ?? setInterval.mock.calls[0]?.[0];
    expect(registeredIntervalHandler).toEqual(expect.any(Function));
    (registeredIntervalHandler as () => void)();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ipcInvokeMock).toHaveBeenCalledTimes(2);

    stop();
    expect(clearInterval).toHaveBeenCalledWith(123);
    expect(removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      addEventListener.mock.calls[0]?.[1],
    );
  });

  it('exposes all renderer bridge aliases before starting telemetry reporting', () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener,
        removeEventListener,
      },
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        hidden: false,
        visibilityState: 'visible',
      },
    });

    try {
      exposePreloadBridge();
      expect(exposeInMainWorldMock.mock.calls.map((call) => call[0])).toEqual([
        'polymarketMonitor',
        'warningApi',
        'electronAPI',
        'api',
      ]);
    } finally {
      const stopReporter = startRendererMemoryTelemetryReporter();
      stopReporter();
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
    }
  });
});
