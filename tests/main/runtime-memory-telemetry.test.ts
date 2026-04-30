import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAppMetricsMock } = vi.hoisted(() => ({
  getAppMetricsMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getAppMetrics: getAppMetricsMock,
  },
}));

import { RuntimeMemoryTelemetryService } from '../../src/main/services/runtime-memory-telemetry';

describe('runtime memory telemetry service', () => {
  beforeEach(() => {
    getAppMetricsMock.mockReset();
  });

  it('aggregates browser, tab, and renderer telemetry into the latest snapshot', async () => {
    getAppMetricsMock.mockReturnValue([
      createProcessMetric({
        pid: process.pid,
        type: 'Browser',
        memory: {
          workingSetSize: 320_000,
          peakWorkingSetSize: 350_000,
          privateBytes: 260_000,
        },
        cpu: 0.8,
      }),
      createProcessMetric({
        pid: 4321,
        type: 'Tab',
        name: 'Renderer',
        memory: {
          workingSetSize: 188_000,
          peakWorkingSetSize: 214_000,
          privateBytes: 176_000,
        },
        cpu: 2.6,
      }),
      createProcessMetric({
        pid: 9001,
        type: 'Utility',
        name: 'Audio Service',
        memory: {
          workingSetSize: 45_000,
          peakWorkingSetSize: 52_000,
          privateBytes: 24_000,
        },
      }),
    ]);
    const service = new RuntimeMemoryTelemetryService({
      now: () => new Date('2026-04-28T09:00:00.000Z'),
      getBrowserProcessMemoryInfo: async () => ({
        private: 240_000,
        residentSet: 310_000,
        shared: 72_000,
      }),
    });

    const snapshot = await service.recordRendererReport(
      {
        sampledAt: '2026-04-28T09:00:05.000Z',
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
      },
      {
        webContentsId: 7,
        browserWindowId: 3,
        url: 'file:///renderer/index.html',
        title: 'Warning App',
      },
    );

    expect(snapshot).toMatchObject({
      sampledAt: '2026-04-28T09:00:05.000Z',
      browser: {
        pid: process.pid,
        cpuPercent: 0.8,
        processMemory: {
          privateKb: 240_000,
          residentSetKb: 310_000,
          sharedKb: 72_000,
        },
        appMetrics: {
          workingSetKb: 320_000,
          peakWorkingSetKb: 350_000,
          privateBytesKb: 260_000,
        },
      },
      renderer: {
        pid: 4321,
        webContentsId: 7,
        browserWindowId: 3,
        url: 'file:///renderer/index.html',
        title: 'Warning App',
        hidden: false,
        visibilityState: 'visible',
        appMetrics: {
          workingSetKb: 188_000,
          peakWorkingSetKb: 214_000,
          privateBytesKb: 176_000,
        },
        cpuPercent: 2.6,
      },
    });
    expect(snapshot.tabs).toHaveLength(1);
    expect(snapshot.tabs[0]).toMatchObject({
      pid: 4321,
      name: 'Renderer',
      memory: {
        workingSetKb: 188_000,
        peakWorkingSetKb: 214_000,
        privateBytesKb: 176_000,
      },
    });

    const latest = service.getLatestSnapshot();
    expect(latest).toEqual(snapshot);
    expect(latest).not.toBe(snapshot);
  });

  it('falls back to a partial snapshot when metrics collection fails', async () => {
    getAppMetricsMock.mockImplementation(() => {
      throw new Error('metrics unavailable');
    });
    const service = new RuntimeMemoryTelemetryService({
      now: () => new Date('2026-04-28T09:05:00.000Z'),
      getBrowserProcessMemoryInfo: async () => {
        throw new Error('process memory unavailable');
      },
    });

    const snapshot = await service.captureSnapshot();

    expect(snapshot).toEqual({
      sampledAt: '2026-04-28T09:05:00.000Z',
      browser: null,
      tabs: [],
      renderer: null,
    });
  });
});

const createProcessMetric = ({
  pid,
  type,
  name,
  memory,
  cpu = 0,
}: {
  pid: number;
  type: Electron.ProcessMetric['type'];
  name?: string;
  memory: {
    workingSetSize: number;
    peakWorkingSetSize: number;
    privateBytes?: number;
  };
  cpu?: number;
}): Electron.ProcessMetric =>
  ({
    pid,
    type,
    name,
    creationTime: 1,
    cpu: {
      percentCPUUsage: cpu,
      idleWakeupsPerSecond: 0,
      cumulativeCPUUsage: 0,
    },
    memory,
    integrityLevel: 'medium',
    sandboxed: false,
  }) as unknown as Electron.ProcessMetric;
