import { app } from 'electron';

import type {
  RuntimeBlinkMemoryInfo,
  RuntimeBrowserMemoryTelemetry,
  RuntimeMemoryProcessInfo,
  RuntimeMemoryTelemetry,
  RuntimeMemoryWorkingSetInfo,
  RuntimeRendererMemoryReport,
  RuntimeRendererMemoryTelemetry,
  RuntimeTabMemoryTelemetry,
} from '@/shared/monitor-contracts';

export interface RuntimeMemoryTelemetryServiceOptions {
  now?: () => Date;
  getAppMetrics?: () => Electron.ProcessMetric[];
  getBrowserProcessMemoryInfo?: () => Promise<Electron.ProcessMemoryInfo>;
}

export interface RuntimeMemoryTelemetryContext {
  webContentsId: number | null;
  browserWindowId: number | null;
  url: string | null;
  title: string | null;
}

export class RuntimeMemoryTelemetryService {
  private readonly now: () => Date;
  private readonly getAppMetrics: () => Electron.ProcessMetric[];
  private readonly getBrowserProcessMemoryInfo: () => Promise<Electron.ProcessMemoryInfo>;
  private latestRenderer: RuntimeRendererMemoryTelemetry | null = null;
  private latestSnapshot: RuntimeMemoryTelemetry | undefined;

  constructor(options: RuntimeMemoryTelemetryServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.getAppMetrics = options.getAppMetrics ?? (() => app.getAppMetrics());
    this.getBrowserProcessMemoryInfo =
      options.getBrowserProcessMemoryInfo ?? (() => process.getProcessMemoryInfo());
  }

  getLatestSnapshot(): RuntimeMemoryTelemetry | undefined {
    return cloneSnapshot(this.latestSnapshot);
  }

  async captureSnapshot(sampledAt = this.now().toISOString()): Promise<RuntimeMemoryTelemetry> {
    const metrics = safeGetAppMetrics(this.getAppMetrics);
    const browserMetric = resolveBrowserMetric(metrics);
    const browserProcessMemory = await safeGetBrowserProcessMemoryInfo(
      this.getBrowserProcessMemoryInfo,
    );
    const tabs = metrics
      .filter((metric) => metric.type === 'Tab')
      .map((metric) => toTabTelemetry(metric, sampledAt));
    const rendererMetric = this.latestRenderer
      ? metrics.find((metric) => metric.type === 'Tab' && metric.pid === this.latestRenderer?.pid) ??
        null
      : null;

    const snapshot: RuntimeMemoryTelemetry = {
      sampledAt,
      browser: toBrowserTelemetry(browserMetric, browserProcessMemory, sampledAt),
      tabs,
      renderer: this.latestRenderer
        ? toRendererTelemetry(this.latestRenderer, rendererMetric)
        : null,
    };
    this.latestSnapshot = snapshot;
    return cloneSnapshot(snapshot) as RuntimeMemoryTelemetry;
  }

  async recordRendererReport(
    report: RuntimeRendererMemoryReport,
    context: RuntimeMemoryTelemetryContext,
  ): Promise<RuntimeMemoryTelemetry> {
    this.latestRenderer = {
      sampledAt: report.sampledAt,
      pid: report.pid,
      webContentsId: context.webContentsId,
      browserWindowId: context.browserWindowId,
      url: context.url,
      title: context.title,
      hidden: report.hidden,
      visibilityState: report.visibilityState,
      processMemory: report.processMemory ? { ...report.processMemory } : null,
      blinkMemory: report.blinkMemory ? { ...report.blinkMemory } : null,
      appMetrics: null,
      cpuPercent: null,
      creationTime: null,
    };
    return this.captureSnapshot(report.sampledAt);
  }
}

const resolveBrowserMetric = (
  metrics: Electron.ProcessMetric[],
): Electron.ProcessMetric | null =>
  metrics.find((metric) => metric.pid === process.pid) ??
  metrics.find((metric) => metric.type === 'Browser') ??
  null;

const toBrowserTelemetry = (
  metric: Electron.ProcessMetric | null,
  processMemory: Electron.ProcessMemoryInfo | null,
  sampledAt: string,
): RuntimeBrowserMemoryTelemetry | null => {
  if (!metric && !processMemory) {
    return null;
  }

  return {
    sampledAt,
    pid: metric?.pid ?? process.pid,
    creationTime: metric?.creationTime ?? null,
    cpuPercent: metric?.cpu.percentCPUUsage ?? null,
    processMemory: processMemory ? toProcessMemory(processMemory) : null,
    appMetrics: metric ? toWorkingSetInfo(metric.memory) : null,
  };
};

const toTabTelemetry = (
  metric: Electron.ProcessMetric,
  sampledAt: string,
): RuntimeTabMemoryTelemetry => ({
  sampledAt,
  pid: metric.pid,
  name: metric.name ?? null,
  serviceName: metric.serviceName ?? null,
  creationTime: metric.creationTime,
  cpuPercent: metric.cpu.percentCPUUsage,
  sandboxed: metric.sandboxed ?? null,
  integrityLevel: metric.integrityLevel ?? null,
  memory: toWorkingSetInfo(metric.memory),
});

const toRendererTelemetry = (
  renderer: RuntimeRendererMemoryTelemetry,
  metric: Electron.ProcessMetric | null,
): RuntimeRendererMemoryTelemetry => ({
  ...renderer,
  processMemory: renderer.processMemory ? { ...renderer.processMemory } : null,
  blinkMemory: renderer.blinkMemory ? { ...renderer.blinkMemory } : null,
  appMetrics: metric ? toWorkingSetInfo(metric.memory) : null,
  cpuPercent: metric?.cpu.percentCPUUsage ?? null,
  creationTime: metric?.creationTime ?? null,
});

const toProcessMemory = (
  value: Electron.ProcessMemoryInfo,
): RuntimeMemoryProcessInfo => ({
  privateKb: value.private,
  residentSetKb: value.residentSet ?? null,
  sharedKb: value.shared,
});

const toWorkingSetInfo = (
  value: Electron.MemoryInfo,
): RuntimeMemoryWorkingSetInfo => ({
  workingSetKb: value.workingSetSize,
  peakWorkingSetKb: value.peakWorkingSetSize,
  privateBytesKb: value.privateBytes ?? null,
});

const cloneSnapshot = <T>(value: T): T => {
  if (value === undefined || value === null) {
    return value;
  }
  return structuredClone(value);
};

const safeGetAppMetrics = (
  getAppMetrics: () => Electron.ProcessMetric[],
): Electron.ProcessMetric[] => {
  try {
    return getAppMetrics();
  } catch {
    return [];
  }
};

const safeGetBrowserProcessMemoryInfo = async (
  getBrowserProcessMemoryInfo: () => Promise<Electron.ProcessMemoryInfo>,
): Promise<Electron.ProcessMemoryInfo | null> => {
  try {
    return await getBrowserProcessMemoryInfo();
  } catch {
    return null;
  }
};

export const createRendererMemoryReport = (
  sampledAt: string,
  pid: number,
  processMemory: RuntimeMemoryProcessInfo | null,
  blinkMemory: RuntimeBlinkMemoryInfo | null,
  visibilityState: string,
  hidden: boolean,
): RuntimeRendererMemoryReport => ({
  sampledAt,
  pid,
  hidden,
  visibilityState,
  processMemory,
  blinkMemory,
});
