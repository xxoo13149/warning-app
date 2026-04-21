import { contextBridge, ipcRenderer } from 'electron';

import type {
  EventChannel,
  EventPayloadMap,
  InvokeChannel,
  InvokePayloadMap,
  InvokeResultMap,
  PreloadApi,
} from './contracts/ipc';

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

export const exposePreloadBridge = (): void => {
  contextBridge.exposeInMainWorld('polymarketMonitor', api);
  contextBridge.exposeInMainWorld('warningApi', api);
  contextBridge.exposeInMainWorld('electronAPI', api);
  contextBridge.exposeInMainWorld('api', api);
};
