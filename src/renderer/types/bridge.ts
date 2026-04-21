export type BridgeListener<T = unknown> = (payload: T) => void;

export interface WarningApiBridge {
  invoke<T = unknown>(channel: string, payload?: unknown): Promise<T>;
  on<T = unknown>(
    channel: string,
    listener: BridgeListener<T>,
  ): (() => void) | void;
  off?<T = unknown>(channel: string, listener: BridgeListener<T>): void;
}

declare global {
  interface Window {
    warningApi?: WarningApiBridge;
    electronAPI?: WarningApiBridge;
    api?: WarningApiBridge;
  }
}

export {};

