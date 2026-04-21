import { app, dialog, ipcMain } from 'electron';
import path from 'node:path';

import type {
  AppHealth,
  EventChannel,
  EventPayloadMap,
  InvokePayloadMap,
  InvokeResultMap,
  RuntimeState,
} from '../contracts/ipc';
import { DEFAULT_HEALTH as DEFAULT_HEALTH_VALUE } from '../contracts/ipc';
import type { CoreWorkerClient } from '../services/core-worker-client';

type EmitEvent = <C extends EventChannel>(channel: C, payload: EventPayloadMap[C]) => void;

interface RegisterIpcHandlersOptions {
  coreClient: CoreWorkerClient;
  getRuntimeState: () => RuntimeState;
  setRuntimeState: (updater: (prev: RuntimeState) => RuntimeState) => void;
  emitEvent: EmitEvent;
  getControlState: () => RuntimeState['controlState'];
  setNotificationsEnabled: (enabled: boolean) => RuntimeState['controlState'];
  startMonitoring: () => Promise<RuntimeState['controlState']>;
  stopMonitoring: () => Promise<RuntimeState['controlState']>;
  quitApplication: () => RuntimeState['controlState'];
  previewSoundFromPath: (filePath: string, gain?: number) => Promise<boolean>;
}

export const registerIpcHandlers = ({
  coreClient,
  getRuntimeState,
  setRuntimeState,
  emitEvent,
  getControlState,
  setNotificationsEnabled,
  startMonitoring,
  stopMonitoring,
  quitApplication,
  previewSoundFromPath,
}: RegisterIpcHandlersOptions): void => {
  ipcMain.handle('app.getHealth', async (): Promise<InvokeResultMap['app.getHealth']> => {
    try {
      const health = await coreClient.invoke('app.getHealth');
      setRuntimeState((prev) => ({ ...prev, health }));
      return health;
    } catch {
      const fallbackHealth = toDegradedHealth(getRuntimeState().health);
      setRuntimeState((prev) => ({ ...prev, health: fallbackHealth }));
      emitEvent('app.health', fallbackHealth);
      return fallbackHealth;
    }
  });

  ipcMain.handle(
    'app.getControlState',
    async (): Promise<InvokeResultMap['app.getControlState']> => getControlState(),
  );

  ipcMain.handle(
    'app.control',
    async (
      _event,
      payload: InvokePayloadMap['app.control'],
    ): Promise<InvokeResultMap['app.control']> => {
      let nextState = getControlState();
      try {
        switch (payload.action) {
          case 'enableNotifications':
            nextState = setNotificationsEnabled(true);
            break;
          case 'disableNotifications':
            nextState = setNotificationsEnabled(false);
            break;
          case 'startMonitor':
            nextState = await startMonitoring();
            break;
          case 'stopMonitor':
            nextState = await stopMonitoring();
            break;
          case 'quitApp':
            nextState = quitApplication();
            break;
          default:
            return {
              ok: false,
              error: {
                code: 'UNSUPPORTED_ACTION',
                message: `Unsupported app control action: ${String(payload.action)}`,
                retriable: false,
              },
              ...nextState,
            };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: {
            code: message.startsWith('STARTUP_TIMEOUT')
              ? 'STARTUP_TIMEOUT'
              : 'CONTROL_ERROR',
            message,
            retriable: true,
          },
          ...nextState,
        };
      }

      return {
        ok: true,
        ...nextState,
      };
    },
  );

  ipcMain.handle(
    'dashboard.query',
    async (_event, payload: InvokePayloadMap['dashboard.query']) => {
      try {
        return await coreClient.invoke('dashboard.query', payload);
      } catch {
        return {
          rows: [],
          coveredMarketCount: 0,
          visibleCityCount: 0,
          totalCityCount: 0,
          hiddenCityCount: 0,
          selectedDate: payload?.eventDate ?? '',
          scope: payload?.scope ?? 'risk',
          availableDates: [],
          updatedAt: new Date(0).toISOString(),
        };
      }
    },
  );

  ipcMain.handle(
    'markets.query',
    async (_event, payload: InvokePayloadMap['markets.query']) => {
      try {
        return await coreClient.invoke('markets.query', payload);
      } catch {
        return { rows: [], total: 0 };
      }
    },
  );

  ipcMain.handle(
    'alerts.list',
    async (_event, payload: InvokePayloadMap['alerts.list']) => {
      try {
        return await coreClient.invoke('alerts.list', payload);
      } catch {
        return { rows: [], total: 0 };
      }
    },
  );

  ipcMain.handle('alerts.ack', async (_event, payload: InvokePayloadMap['alerts.ack']) => {
    try {
      return await coreClient.invoke('alerts.ack', payload);
    } catch {
      return { ok: true, updated: 0 };
    }
  });

  ipcMain.handle('rules.list', async () => {
    try {
      return await coreClient.invoke('rules.list');
    } catch {
      return { rows: [] };
    }
  });

  ipcMain.handle('rules.preview', async (_event, payload: InvokePayloadMap['rules.preview']) =>
    coreClient.invoke('rules.preview', payload).catch(() => ({
      matchedCityCount: 0,
      matchedMarketCount: 0,
      sampleMarkets: [],
    })),
  );

  ipcMain.handle('rules.save', async (_event, payload: InvokePayloadMap['rules.save']) =>
    coreClient.invoke('rules.save', payload).catch(() => ({
      rows: Array.isArray(payload) ? payload : payload?.rules ?? [],
    })),
  );

  ipcMain.handle('settings.get', async (): Promise<InvokeResultMap['settings.get']> => {
    try {
      const settingsPayload = await coreClient.invoke('settings.get');
      setRuntimeState((prev) => ({ ...prev, settingsPayload }));
      applyLoginItem(settingsPayload.settings.startOnBoot);
      return settingsPayload;
    } catch {
      return getRuntimeState().settingsPayload;
    }
  });

  ipcMain.handle(
    'settings.update',
    async (
      _event,
      payload: InvokePayloadMap['settings.update'],
    ): Promise<InvokeResultMap['settings.update']> => {
      try {
        const settingsPayload = await coreClient.invoke('settings.update', payload);
        setRuntimeState((prev) => ({ ...prev, settingsPayload }));
        applyLoginItem(settingsPayload.settings.startOnBoot);
        return settingsPayload;
      } catch {
        return getRuntimeState().settingsPayload;
      }
    },
  );

  ipcMain.handle(
    'settings.importCityMap',
    async (
      _event,
      payload: InvokePayloadMap['settings.importCityMap'],
    ): Promise<InvokeResultMap['settings.importCityMap']> =>
      coreClient.invoke('settings.importCityMap', payload).catch(() => ({
        ok: true,
        imported: 0,
      })),
  );

  ipcMain.handle(
    'settings.pickSound',
    async (
      _event,
      payload: InvokePayloadMap['settings.pickSound'],
    ): Promise<InvokeResultMap['settings.pickSound']> => {
      if (payload?.id) {
        try {
          const nextPayload = await coreClient.invoke('settings.pickSound', payload);
          setRuntimeState((prev) => ({ ...prev, settingsPayload: nextPayload }));
          return nextPayload;
        } catch {
          return getRuntimeState().settingsPayload;
        }
      }

      const result = await dialog.showOpenDialog({
        title: 'Select alert sound',
        properties: ['openFile'],
        filters: [
          {
            name: 'Audio',
            extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'],
          },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return getRuntimeState().settingsPayload;
      }

      try {
        const nextPayload = await coreClient.invoke('settings.registerSound', {
          filePath: result.filePaths[0],
          name: path.basename(result.filePaths[0]),
          setAsDefault: true,
        });
        setRuntimeState((prev) => ({ ...prev, settingsPayload: nextPayload }));
        return nextPayload;
      } catch {
        return getRuntimeState().settingsPayload;
      }
    },
  );

  ipcMain.handle(
    'settings.registerSound',
    async (
      _event,
      payload: InvokePayloadMap['settings.registerSound'],
    ): Promise<InvokeResultMap['settings.registerSound']> => {
      let request = payload;
      const needsFilePicker =
        !request?.filePath &&
        !request?.name &&
        request?.gain === undefined &&
        request?.enabled === undefined &&
        request?.setAsDefault === undefined &&
        request?.isBuiltin === undefined;

      if (needsFilePicker) {
        const result = await dialog.showOpenDialog({
          title: 'Import alert sound',
          properties: ['openFile'],
          filters: [
            {
              name: 'Audio',
              extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'],
            },
          ],
        });

        if (result.canceled || result.filePaths.length === 0) {
          return getRuntimeState().settingsPayload;
        }

        request = {
          ...request,
          filePath: result.filePaths[0],
          name: path.basename(result.filePaths[0]),
        };
      }

      try {
        const nextPayload = await coreClient.invoke('settings.registerSound', request);
        setRuntimeState((prev) => ({ ...prev, settingsPayload: nextPayload }));
        return nextPayload;
      } catch {
        return getRuntimeState().settingsPayload;
      }
    },
  );

  ipcMain.handle(
    'settings.previewSound',
    async (
      _event,
      payload: InvokePayloadMap['settings.previewSound'],
    ): Promise<InvokeResultMap['settings.previewSound']> => {
      const soundProfiles = getRuntimeState().settingsPayload.soundProfiles;
      const targetSound = payload?.id
        ? soundProfiles.find((profile) => profile.id === payload.id)
        : undefined;
      const filePath = payload?.filePath ?? targetSound?.filePath ?? '';
      if (!filePath) {
        return { ok: true, played: false };
      }

      const played = await previewSoundFromPath(filePath, payload?.gain ?? targetSound?.gain ?? 1);
      return { ok: true, played };
    },
  );

  coreClient.on('app.health', (payload) => {
    setRuntimeState((prev) => ({ ...prev, health: payload }));
    emitEvent('app.health', payload);
  });

  coreClient.on('dashboard.tick', (payload) => {
    emitEvent('dashboard.tick', payload);
  });

  coreClient.on('markets.tick', (payload) => {
    emitEvent('markets.tick', payload);
  });

  coreClient.on('alerts.new', (payload) => {
    emitEvent('alerts.new', payload);
  });
};

function applyLoginItem(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
  });
}

function toDegradedHealth(current: AppHealth | undefined): AppHealth {
  const base = current ?? DEFAULT_HEALTH_VALUE;
  return {
    ...base,
    connected: false,
    mode: 'degraded',
    lastSyncAt: new Date().toISOString(),
    droppedEvents: (base.droppedEvents ?? 0) + 1,
    workerRunning: base.workerRunning ?? true,
    startupPhase: 'degraded',
    diagnostic: base.diagnostic ?? '监控数据流当前不可用。',
  };
}
