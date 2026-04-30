import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS } from '../shared/constants';
import type {
  RuntimeBlinkMemoryInfo,
  RuntimeMemoryProcessInfo,
  RuntimeRendererMemoryReport,
} from '../shared/monitor-contracts';
import type {
  EventChannel,
  EventPayloadMap,
  InvokeChannel,
  InvokePayloadMap,
  InvokeResultMap,
  PreloadApi,
} from './contracts/ipc';

const MEMORY_TELEMETRY_INTERVAL_MS = 30_000;

type EventListenerRegistrar = (type: string, listener: () => void) => void;

export interface RendererMemoryTelemetrySamplerOptions {
  invoke?: (channel: string, payload: RuntimeRendererMemoryReport) => Promise<unknown>;
  now?: () => Date;
  getPid?: () => number;
  getProcessMemoryInfo?: () => Promise<Electron.ProcessMemoryInfo>;
  getBlinkMemoryInfo?: () => Electron.BlinkMemoryInfo;
  getVisibilityState?: () => string;
  isHidden?: () => boolean;
}

export interface RendererMemoryTelemetryReporterOptions
  extends RendererMemoryTelemetrySamplerOptions {
  setInterval?: (handler: () => void, timeout: number) => ReturnType<typeof globalThis.setInterval>;
  clearInterval?: (handle: ReturnType<typeof globalThis.setInterval>) => void;
  addEventListener?: EventListenerRegistrar;
  removeEventListener?: EventListenerRegistrar;
}

const invoke = <C extends InvokeChannel>(
  channel: C,
  payload?: InvokePayloadMap[C],
): Promise<InvokeResultMap[C]> =>
  ipcRenderer.invoke(channel, payload as InvokePayloadMap[C]) as Promise<InvokeResultMap[C]>;

const on = <C extends EventChannel>(
  channel: C,
  listener: (payload: EventPayloadMap[C]) => void,
): (() => void) => {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: EventPayloadMap[C]): void => {
    listener(payload);
  };

  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
};

const api: PreloadApi = { invoke, on };

let stopRendererMemoryTelemetryReporter: (() => void) | null = null;

export const sampleAndReportRendererMemoryTelemetry = async (
  options: RendererMemoryTelemetrySamplerOptions = {},
): Promise<RuntimeRendererMemoryReport | null> => {
  const invokeReport =
    options.invoke ??
    ((channel: string, payload: RuntimeRendererMemoryReport) => ipcRenderer.invoke(channel, payload));

  try {
    const [processMemoryInfo, blinkMemoryInfo] = await Promise.all([
      (options.getProcessMemoryInfo ?? (() => process.getProcessMemoryInfo()))(),
      Promise.resolve((options.getBlinkMemoryInfo ?? (() => process.getBlinkMemoryInfo()))()),
    ]);
    const payload: RuntimeRendererMemoryReport = {
      sampledAt: (options.now ?? (() => new Date()))().toISOString(),
      pid: (options.getPid ?? (() => process.pid))(),
      hidden: (options.isHidden ?? (() => document.hidden))(),
      visibilityState: (options.getVisibilityState ?? (() => document.visibilityState))(),
      processMemory: toRuntimeProcessMemoryInfo(processMemoryInfo),
      blinkMemory: toRuntimeBlinkMemoryInfo(blinkMemoryInfo),
    };
    await invokeReport(IPC_CHANNELS.internal.telemetryMemoryReport, payload);
    return payload;
  } catch {
    return null;
  }
};

export const startRendererMemoryTelemetryReporter = (
  options: RendererMemoryTelemetryReporterOptions = {},
): (() => void) => {
  if (stopRendererMemoryTelemetryReporter) {
    return stopRendererMemoryTelemetryReporter;
  }

  const addEventListener =
    options.addEventListener ??
    ((type: string, listener: () => void) => window.addEventListener(type, listener));
  const removeEventListener =
    options.removeEventListener ??
    ((type: string, listener: () => void) => window.removeEventListener(type, listener));
  const setIntervalFn = options.setInterval ?? globalThis.setInterval;
  const clearIntervalFn = options.clearInterval ?? globalThis.clearInterval;
  let inFlight = false;

  const triggerSample = (): void => {
    if (inFlight) {
      return;
    }
    inFlight = true;
    void sampleAndReportRendererMemoryTelemetry(options).finally(() => {
      inFlight = false;
    });
  };

  const intervalHandle = setIntervalFn(triggerSample, MEMORY_TELEMETRY_INTERVAL_MS);
  const handleVisibilityChange = (): void => {
    triggerSample();
  };

  addEventListener('visibilitychange', handleVisibilityChange);
  triggerSample();

  stopRendererMemoryTelemetryReporter = () => {
    clearIntervalFn(intervalHandle);
    removeEventListener('visibilitychange', handleVisibilityChange);
    stopRendererMemoryTelemetryReporter = null;
  };

  return stopRendererMemoryTelemetryReporter;
};

export const exposePreloadBridge = (): void => {
  contextBridge.exposeInMainWorld('polymarketMonitor', api);
  contextBridge.exposeInMainWorld('warningApi', api);
  contextBridge.exposeInMainWorld('electronAPI', api);
  contextBridge.exposeInMainWorld('api', api);
  startRendererMemoryTelemetryReporter();
};

const toRuntimeProcessMemoryInfo = (
  value: Electron.ProcessMemoryInfo,
): RuntimeMemoryProcessInfo => ({
  privateKb: value.private,
  residentSetKb: value.residentSet ?? null,
  sharedKb: value.shared,
});

const toRuntimeBlinkMemoryInfo = (
  value: Electron.BlinkMemoryInfo,
): RuntimeBlinkMemoryInfo => ({
  allocatedKb: value.allocated,
  totalKb: value.total,
});
