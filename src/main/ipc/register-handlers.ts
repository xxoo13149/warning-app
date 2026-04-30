import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
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
import { IPC_CHANNELS } from '@/shared/constants';
import type { RuntimeRendererMemoryReport } from '@/shared/monitor-contracts';
import type { CoreWorkerClient } from '../services/core-worker-client';
import type { RuntimeMemoryTelemetryService } from '../services/runtime-memory-telemetry';
import type { PreviewSoundPlaybackResult } from '../services/audio-window';
import {
  clearRuntimeStorageCache,
  createRuntimeStorageBackup,
  inspectRuntimeStorageSummary,
} from '../services/runtime-storage';
import { createRuntimeDiagnosticsPackage } from '../services/runtime-diagnostics';
import type { RuntimePaths } from '../services/runtime-paths';

type EmitEvent = <C extends EventChannel>(channel: C, payload: EventPayloadMap[C]) => void;

interface RegisterIpcHandlersOptions {
  coreClient: CoreWorkerClient;
  runtimePaths: RuntimePaths;
  memoryTelemetryService: RuntimeMemoryTelemetryService;
  getRuntimeState: () => RuntimeState;
  setRuntimeState: (updater: (prev: RuntimeState) => RuntimeState) => void;
  setRuntimeHealth: (health: RuntimeState['health']) => void;
  emitEvent: EmitEvent;
  getControlState: () => RuntimeState['controlState'];
  setNotificationsEnabled: (enabled: boolean) => RuntimeState['controlState'];
  startMonitoring: () => Promise<RuntimeState['controlState']>;
  stopMonitoring: () => Promise<RuntimeState['controlState']>;
  quitApplication: () => Promise<RuntimeState['controlState']>;
  previewSoundFromPath: (filePath: string, gain?: number) => Promise<PreviewSoundPlaybackResult>;
}

export const registerIpcHandlers = ({
  coreClient,
  runtimePaths,
  memoryTelemetryService,
  getRuntimeState,
  setRuntimeState,
  setRuntimeHealth,
  emitEvent,
  getControlState,
  setNotificationsEnabled,
  startMonitoring,
  stopMonitoring,
  quitApplication,
  previewSoundFromPath,
}: RegisterIpcHandlersOptions): (() => void) => {
  const attachStorageSummary = (
    settingsPayload: RuntimeState['settingsPayload'],
  ): RuntimeState['settingsPayload'] => ({
    ...settingsPayload,
    storageSummary: inspectRuntimeStorageSummary(runtimePaths),
  });
  const getSettingsPayloadWithStorageSummary = (): RuntimeState['settingsPayload'] =>
    attachStorageSummary(getRuntimeState().settingsPayload);

  ipcMain.handle('app.getHealth', async (): Promise<InvokeResultMap['app.getHealth']> => {
    try {
      const health = await coreClient.invoke('app.getHealth');
      setRuntimeHealth(health);
      return getRuntimeState().health;
    } catch {
      const fallbackHealth = toDegradedHealth(getRuntimeState().health);
      setRuntimeHealth(fallbackHealth);
      return getRuntimeState().health;
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
            nextState = await quitApplication();
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
    async (_event, payload: InvokePayloadMap['alerts.list']) =>
      coreClient.invoke('alerts.list', payload),
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

  ipcMain.handle(
    'storage.clearCache',
    async (): Promise<InvokeResultMap['storage.clearCache']> => {
      await session.defaultSession.clearCache().catch(() => undefined);
      const result = await clearRuntimeStorageCache(runtimePaths);
      setRuntimeState((prev) => ({
        ...prev,
        settingsPayload: {
          ...prev.settingsPayload,
          storageSummary: result.storageSummary,
        },
      }));
      return result;
    },
  );

  ipcMain.handle(
    'storage.createBackup',
    async (): Promise<InvokeResultMap['storage.createBackup']> => {
      const result = await createRuntimeStorageBackup(runtimePaths);
      setRuntimeState((prev) => ({
        ...prev,
        settingsPayload: {
          ...prev.settingsPayload,
          storageSummary: result.storageSummary,
        },
      }));
      return result;
    },
  );

  ipcMain.handle(
    'storage.createDiagnostics',
    async (): Promise<InvokeResultMap['storage.createDiagnostics']> =>
      createRuntimeDiagnosticsPackage(runtimePaths, {
        memoryTelemetry: memoryTelemetryService.getLatestSnapshot(),
      }),
  );

  ipcMain.handle(
    'storage.runMaintenance',
    async (): Promise<InvokeResultMap['storage.runMaintenance']> => {
      const workerResult = await coreClient.invoke('storage.runMaintenance');
      const result = {
        ...workerResult,
        storageSummary: inspectRuntimeStorageSummary(runtimePaths),
      } satisfies InvokeResultMap['storage.runMaintenance'];
      setRuntimeState((prev) => ({
        ...prev,
        settingsPayload: {
          ...prev.settingsPayload,
          storageSummary: result.storageSummary,
          storageMaintenance: result.summary,
        },
      }));
      return result;
    },
  );

  ipcMain.handle('settings.get', async (): Promise<InvokeResultMap['settings.get']> => {
    try {
      const settingsPayload = attachStorageSummary(await coreClient.invoke('settings.get'));
      setRuntimeState((prev) => ({ ...prev, settingsPayload }));
      applyLoginItem(settingsPayload.settings.startOnBoot);
      return settingsPayload;
    } catch {
      return getSettingsPayloadWithStorageSummary();
    }
  });

  ipcMain.handle(
    'settings.update',
    async (
      _event,
      payload: InvokePayloadMap['settings.update'],
    ): Promise<InvokeResultMap['settings.update']> => {
      try {
        const settingsPayload = attachStorageSummary(
          await coreClient.invoke('settings.update', payload),
        );
        setRuntimeState((prev) => ({ ...prev, settingsPayload }));
        applyLoginItem(settingsPayload.settings.startOnBoot);
        return settingsPayload;
      } catch {
        return getSettingsPayloadWithStorageSummary();
      }
    },
  );

  ipcMain.handle(
    'settings.importCityMap',
    async (
      _event,
      payload: InvokePayloadMap['settings.importCityMap'],
    ): Promise<InvokeResultMap['settings.importCityMap']> =>
      coreClient.invoke('settings.importCityMap', payload),
  );

  ipcMain.handle(
    'settings.pickSound',
    async (
      _event,
      payload: InvokePayloadMap['settings.pickSound'],
    ): Promise<InvokeResultMap['settings.pickSound']> => {
      if (payload?.id) {
        try {
          const nextPayload = attachStorageSummary(
            await coreClient.invoke('settings.pickSound', payload),
          );
          setRuntimeState((prev) => ({ ...prev, settingsPayload: nextPayload }));
          return nextPayload;
        } catch {
          return getSettingsPayloadWithStorageSummary();
        }
      }

      const result = await dialog.showOpenDialog({
        title: '选择告警提示音',
        properties: ['openFile'],
        filters: [
          {
            name: '音频文件',
            extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'],
          },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return getRuntimeState().settingsPayload;
      }

      try {
        const nextPayload = attachStorageSummary(
          await coreClient.invoke('settings.registerSound', {
            filePath: result.filePaths[0],
            name: path.basename(result.filePaths[0]),
            setAsDefault: true,
          }),
        );
        setRuntimeState((prev) => ({ ...prev, settingsPayload: nextPayload }));
        return nextPayload;
      } catch {
        return getSettingsPayloadWithStorageSummary();
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
          title: '导入告警提示音',
          properties: ['openFile'],
          filters: [
            {
              name: '音频文件',
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

      const nextPayload = attachStorageSummary(
        await coreClient.invoke('settings.registerSound', request),
      );
      setRuntimeState((prev) => ({ ...prev, settingsPayload: nextPayload }));
      return nextPayload;
    },
  );

  ipcMain.handle(
    'settings.previewSound',
    async (
      _event,
      payload: InvokePayloadMap['settings.previewSound'],
    ): Promise<InvokeResultMap['settings.previewSound']> => {
      const soundProfiles = getRuntimeState().settingsPayload.soundProfiles;
      const selectedSoundId = getRuntimeState().settingsPayload.settings.selectedSoundProfileId;
      const targetSound = payload?.id
        ? soundProfiles.find((profile) => profile.id === payload.id)
        : soundProfiles.find((profile) => profile.id === selectedSoundId);
      const filePath = payload?.filePath ?? targetSound?.filePath ?? '';
      if (!filePath) {
        return { ok: true, played: false };
      }

      const result = await previewSoundFromPath(filePath, payload?.gain ?? targetSound?.gain ?? 1);
      return { ok: true, ...result };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.internal.telemetryMemoryReport,
    async (
      event,
      payload: RuntimeRendererMemoryReport,
    ): Promise<{ ok: true }> => {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      await memoryTelemetryService.recordRendererReport(payload, {
        webContentsId: event.sender.id,
        browserWindowId: ownerWindow?.id ?? null,
        url: event.sender.getURL() || null,
        title: ownerWindow?.getTitle() ?? null,
      });
      setRuntimeHealth(getRuntimeState().health);
      return { ok: true };
    },
  );

  const handleAppHealth = (payload: AppHealth) => {
    setRuntimeHealth(payload);
  };

  const handleDashboardTick = (payload: EventPayloadMap['dashboard.tick']) => {
    emitEvent('dashboard.tick', payload);
  };

  const handleMarketsTick = (payload: EventPayloadMap['markets.tick']) => {
    emitEvent('markets.tick', payload);
  };

  const handleAlertsNew = (payload: EventPayloadMap['alerts.new']) => {
    emitEvent('alerts.new', payload);
  };

  coreClient.on('app.health', handleAppHealth);
  coreClient.on('dashboard.tick', handleDashboardTick);
  coreClient.on('markets.tick', handleMarketsTick);
  coreClient.on('alerts.new', handleAlertsNew);

  return () => {
    coreClient.off('app.health', handleAppHealth);
    coreClient.off('dashboard.tick', handleDashboardTick);
    coreClient.off('markets.tick', handleMarketsTick);
    coreClient.off('alerts.new', handleAlertsNew);
  };
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
