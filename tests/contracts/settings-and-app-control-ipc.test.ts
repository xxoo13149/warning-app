import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { INVOKE_CHANNELS } from '../../src/main/contracts/ipc';
import { APP_USER_MODEL_ID, IPC_CHANNELS } from '../../src/shared/constants';
import type {
  AppControlRequest,
  PreviewSoundResult,
  SettingsUpdatePayload,
  WorkerRequestMap,
  WorkerResponseMap,
} from '../../src/shared/contracts';

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('settings and app control IPC contracts', () => {
  it('keeps settings channels available in main and shared constants', () => {
    const invokeChannels = new Set<string>(INVOKE_CHANNELS);
    expect(invokeChannels.has('app.getControlState')).toBe(true);
    expect(invokeChannels.has('app.control')).toBe(true);
    expect(invokeChannels.has('storage.clearCache')).toBe(true);
    expect(invokeChannels.has('storage.createBackup')).toBe(true);
    expect(invokeChannels.has('storage.createDiagnostics')).toBe(true);
    expect(invokeChannels.has('storage.runMaintenance')).toBe(true);
    expect(invokeChannels.has('settings.get')).toBe(true);
    expect(invokeChannels.has('settings.update')).toBe(true);

    const sharedInvokes = new Set<string>(Object.values(IPC_CHANNELS.invoke));
    expect(sharedInvokes.has('storage.clearCache')).toBe(true);
    expect(sharedInvokes.has('storage.createBackup')).toBe(true);
    expect(sharedInvokes.has('storage.createDiagnostics')).toBe(true);
    expect(sharedInvokes.has('storage.runMaintenance')).toBe(true);
    expect(sharedInvokes.has('settings.get')).toBe(true);
    expect(sharedInvokes.has('settings.update')).toBe(true);
  });

  it('registers settings handlers and applies startup control on get/update', () => {
    const source = readSource('src/main/ipc/register-handlers.ts');

    expect(/ipcMain\.handle\(\s*'settings\.get'/.test(source)).toBe(true);
    expect(/ipcMain\.handle\(\s*'settings\.update'/.test(source)).toBe(true);
    expect(/ipcMain\.handle\(\s*'storage\.clearCache'/.test(source)).toBe(true);
    expect(/ipcMain\.handle\(\s*'storage\.createBackup'/.test(source)).toBe(true);
    expect(/ipcMain\.handle\(\s*'storage\.createDiagnostics'/.test(source)).toBe(true);
    expect(/ipcMain\.handle\(\s*'storage\.runMaintenance'/.test(source)).toBe(true);
    expect(/ipcMain\.handle\(\s*'settings\.importCityMap'/.test(source)).toBe(true);

    expect(source.includes('applyLoginItem(settingsPayload.settings.startOnBoot);')).toBe(true);
    expect(source.includes("nextState = await quitApplication();")).toBe(true);
  });

  it('worker runtime persists app control keys through settings storage', () => {
    const source = readSource('src/core/worker-runtime.ts');

    expect(source.includes("startOnBoot: 'startOnBoot'")).toBe(true);
    expect(source.includes("backgroundAudio: 'backgroundAudio'")).toBe(true);
    expect(source.includes("tickRetentionDays: 'tickRetentionDays'")).toBe(true);
    expect(source.includes("alertRetentionDays: 'alertRetentionDays'")).toBe(true);
    expect(source.includes("quietHoursStart: 'quietHoursStart'")).toBe(true);
    expect(source.includes("quietHoursEnd: 'quietHoursEnd'")).toBe(true);
    expect(source.includes('case \'settings.update\':')).toBe(true);
  });

  it('app shell routes quit through a unified shutdown coordinator', () => {
    const source = readSource('src/main/app-shell.ts');
    const dispatchPolicySource = readSource('src/main/services/alert-dispatch-policy.ts');

    expect(source.includes('new ShutdownCoordinator<AppControlState>({')).toBe(true);
    expect(source.includes('new LifecycleRunGate()')).toBe(true);
    expect(source.includes("coreClient.off('alerts.new', handleIncomingAlert);")).toBe(true);
    expect(source.includes('markShutdownBegin(previous, {')).toBe(true);
    expect(source.includes('notificationService.destroy();')).toBe(true);
    expect(source.includes("suspendAlertDispatch('shutdown-requested');")).toBe(true);
    expect(source.includes("invalidateLifecycleGeneration('shutdown-requested', { shutdown: true });")).toBe(
      true,
    );
    expect(
      source.includes(
        "invalidateLifecycleGeneration(APPLICATION_QUITTING_REASON, { shutdown: true });",
      ),
    ).toBe(true);
    expect(dispatchPolicySource.includes("reason: 'foreground-window'")).toBe(true);
    expect(source.includes("logNotificationEvent('alert.toast_suppressed'")).toBe(true);
    expect(source.includes("await coreClient.stop().catch(() => undefined);")).toBe(true);
    expect(source.indexOf("name: 'core-worker'")).toBeLessThan(source.indexOf("name: 'notifications'"));
    expect(source.includes('const requestAppShutdown = (): Promise<AppControlState> =>')).toBe(
      true,
    );
    expect(source.includes('quitApplication: requestAppShutdown,')).toBe(true);
    expect(source.includes('shutdownCoordinator?.canQuitApp()')).toBe(true);
    expect(source.includes("app.on('second-instance', () => {")).toBe(true);
    expect(source.includes("event.preventDefault();")).toBe(true);
    expect(source.includes("void requestAppShutdown();")).toBe(true);
  });

  it('treats main-window close and window-all-closed as full shutdown signals', () => {
    const source = readSource('src/main/app-shell.ts');

    expect(
      /mainWindow\.on\('close',[\s\S]*?event\.preventDefault\(\);[\s\S]*?suspendAlertDispatch\('main-window-close'\);[\s\S]*?void requestAppShutdown\(\);/m.test(
        source,
      ),
    ).toBe(true);
    expect(source.includes('Main window close requested full application shutdown.')).toBe(true);
    expect(source.includes('window-all-closed fired; requesting full application shutdown.')).toBe(
      true,
    );
    expect(source.includes('mainWindow.hide();')).toBe(false);
  });

  it('suppresses alert dispatch during stop and shutdown, and hides system toast whenever the window is visible', () => {
    const source = readSource('src/main/app-shell.ts');
    const dispatchPolicySource = readSource('src/main/services/alert-dispatch-policy.ts');

    expect(source.includes('new AlertDispatchPolicy({')).toBe(true);
    expect(source.includes('alertDispatchPolicy.resolve({')).toBe(true);
    expect(source.includes('alertDispatchPolicy.recordNotification();')).toBe(true);
    expect(source.includes("suspendAlertDispatch('monitor-stopping');")).toBe(true);
    expect(source.includes("invalidateLifecycleGeneration('monitor-stopping');")).toBe(true);
    expect(source.includes("const stopGeneration = invalidateLifecycleGeneration('monitor-stopping');")).toBe(
      true,
    );
    expect(source.includes('if (!isLifecycleGenerationCurrent(stopGeneration)) {')).toBe(true);
    expect(source.includes("suspendAlertDispatch('application-quitting');")).toBe(true);
    expect(dispatchPolicySource.includes("'dispatch-suspended'")).toBe(true);
    expect(dispatchPolicySource.includes('): boolean => windowState.visible;')).toBe(true);
  });

  it('commits worker health through the app shell health synchronizer', () => {
    const appShellSource = readSource('src/main/app-shell.ts');
    const handlersSource = readSource('src/main/ipc/register-handlers.ts');

    expect(appShellSource.includes('setRuntimeHealth: setHealth,')).toBe(true);
    expect(handlersSource.includes('setRuntimeHealth: (health: RuntimeState[\'health\']) => void;')).toBe(
      true,
    );
    expect(handlersSource.includes('const handleAppHealth = (payload: AppHealth) => {')).toBe(true);
    expect(handlersSource.includes('setRuntimeHealth(payload);')).toBe(true);
    expect(handlersSource.includes('setRuntimeState((prev) => ({ ...prev, health: payload }))')).toBe(
      false,
    );
  });

  it('reuses an existing main window when second-instance lands during startup', () => {
    const source = readSource('src/main/app-shell.ts');

    expect(source.includes('let focusMainWindowOnReady = false;')).toBe(true);
    expect(source.includes('focusMainWindowOnReady = true;')).toBe(true);
    expect(
      source.includes('Second instance requested before app ready; deferring main window reveal.'),
    ).toBe(true);
    expect(source.includes('Applying deferred main window reveal from second-instance request.')).toBe(
      true,
    );
    expect(source.includes('Second instance requested; focusing existing main window.')).toBe(true);
    expect(
      /if \(!shellState\.mainWindow \|\| shellState\.mainWindow\.isDestroyed\(\)\) \{\s*shellState\.mainWindow = createManagedMainWindow\(\);\s*\} else \{\s*showWindow\(shellState\.mainWindow\);\s*\}/m.test(
        source,
      ),
    ).toBe(true);
  });

  it('main entry enforces single-instance startup before bootstrapping the app shell', () => {
    const source = readSource('src/main/index.ts');

    expect(APP_USER_MODEL_ID).toBe('com.polymarket.weather-monitor');
    expect(source.includes('app.setAppUserModelId(APP_USER_MODEL_ID);')).toBe(true);
    expect(source.includes('app.requestSingleInstanceLock()')).toBe(true);
    expect(source.includes('configureRuntimePaths(app)')).toBe(true);
    expect(source.indexOf('app.setAppUserModelId(APP_USER_MODEL_ID);')).toBeLessThan(
      source.indexOf('configureRuntimePaths(app)'),
    );
    expect(source.indexOf('configureRuntimePaths(app)')).toBeLessThan(
      source.indexOf('app.requestSingleInstanceLock()'),
    );
    expect(source.includes('await prepareRuntimeStorage(app, initialRuntimePaths.dataRootDir);')).toBe(
      true,
    );
    expect(source.includes('await bootstrapAppShell(runtimePaths);')).toBe(true);
  });

  it('worker entry installs the request handler before kicking off runtime startup', () => {
    const source = readSource('src/core/worker-entry.ts');

    expect(source.includes("port.on('message', (message: WorkerRequest) => {")).toBe(true);
    expect(source.includes("void runtime.start().catch((error) => {")).toBe(true);
    expect(source.indexOf("port.on('message', (message: WorkerRequest) => {")).toBeLessThan(
      source.indexOf("void runtime.start().catch((error) => {"),
    );
  });

  it('accepts settings patches and typed app-control actions in shared contracts', () => {
    const patch: SettingsUpdatePayload = {
      startOnBoot: true,
      backgroundAudio: false,
    };

    expect(patch.startOnBoot).toBe(true);
    expect(patch.backgroundAudio).toBe(false);

    expectTypeOf<WorkerRequestMap['settings.update']>().toMatchTypeOf<{
      startOnBoot?: boolean;
      backgroundAudio?: boolean;
      tickRetentionDays?: number;
      alertRetentionDays?: number;
    }>();

    expectTypeOf<AppControlRequest>().toMatchTypeOf<{
      action: 'enableNotifications' | 'disableNotifications' | 'startMonitor' | 'stopMonitor' | 'quitApp';
    }>();
  });

  it('keeps settings responses aligned with payload-based contracts', () => {
    expectTypeOf<WorkerResponseMap['settings.get']>().toMatchTypeOf<{
      settings: object;
      soundProfiles: object[];
    }>();
    expectTypeOf<WorkerResponseMap['settings.update']>().toMatchTypeOf<{
      settings: object;
      soundProfiles: object[];
    }>();
    expectTypeOf<WorkerResponseMap['settings.previewSound']>().toMatchTypeOf<PreviewSoundResult>();
  });
});
