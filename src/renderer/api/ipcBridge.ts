import { createMockBridge } from './mockBridge';
import type { WarningApiBridge, BridgeListener } from '../types/bridge';

const isBridge = (candidate: unknown): candidate is WarningApiBridge => {
  if (!candidate || typeof candidate !== 'object') return false;
  const target = candidate as WarningApiBridge;
  return typeof target.invoke === 'function' && typeof target.on === 'function';
};

const detectNativeBridge = (): WarningApiBridge | null => {
  if (typeof window === 'undefined') return null;
  if (isBridge(window.warningApi)) return window.warningApi;
  if (isBridge(window.electronAPI)) return window.electronAPI;
  if (isBridge(window.api)) return window.api;
  return null;
};

const nativeBridge = detectNativeBridge();
let mockBridge: WarningApiBridge | null = null;

const getMockBridge = (): WarningApiBridge => {
  if (!mockBridge) {
    mockBridge = createMockBridge();
  }
  return mockBridge;
};

export const bridgeMode = nativeBridge ? 'live' : 'mock';

export const ipcBridge: WarningApiBridge = {
  async invoke<T>(channel: string, payload?: unknown): Promise<T> {
    const bridge = nativeBridge ?? getMockBridge();
    return bridge.invoke<T>(channel, payload);
  },
  on<T>(channel: string, listener: BridgeListener<T>) {
    const bridge = nativeBridge ?? getMockBridge();
    return bridge.on(channel, listener);
  },
  off<T>(channel: string, listener: BridgeListener<T>) {
    const bridge = nativeBridge ?? mockBridge;
    if (bridge?.off) {
      bridge.off(channel, listener);
      return;
    }
  },
};
