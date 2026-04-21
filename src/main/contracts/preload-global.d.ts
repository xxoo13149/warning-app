import type { PreloadApi } from './ipc';

declare global {
  interface Window {
    polymarketMonitor: PreloadApi;
    warningApi?: PreloadApi;
    electronAPI?: PreloadApi;
    api?: PreloadApi;
  }
}

export {};
