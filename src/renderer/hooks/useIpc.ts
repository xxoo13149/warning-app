import { useEffect, useRef, useState } from 'react';
import { ipcBridge } from '../api/ipcBridge';
import type { BridgeListener } from '../types/bridge';

export const useIpcInvoke = <T>(channel: string, payload?: unknown) => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (nextPayload?: unknown) => {
    setLoading(true);
    setError(null);
    try {
      const response = await ipcBridge.invoke<T>(channel, nextPayload ?? payload);
      setData(response);
      return response;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'invoke failed';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { data, loading, error, refresh, setData };
};

export const useIpcSubscription = <T>(
  channel: string,
  handler: (payload: T) => void,
) => {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const listener: BridgeListener<T> = (payload) => {
      handlerRef.current(payload);
    };
    const dispose = ipcBridge.on(channel, listener);
    return () => {
      if (typeof dispose === 'function') {
        dispose();
        return;
      }
      if (ipcBridge.off) {
        ipcBridge.off(channel, listener);
      }
    };
  }, [channel]);
};

