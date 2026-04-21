import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { INVOKE_CHANNELS } from '../../src/main/contracts/ipc';
import { IPC_CHANNELS } from '../../src/shared/constants';
import type { AppControlRequest, SettingsUpdatePayload, WorkerRequestMap, WorkerResponseMap } from '../../src/shared/contracts';

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

describe('settings and app control IPC contracts', () => {
  it('keeps settings channels available in main and shared constants', () => {
    const invokeChannels = new Set<string>(INVOKE_CHANNELS);
    expect(invokeChannels.has('app.getControlState')).toBe(true);
    expect(invokeChannels.has('app.control')).toBe(true);
    expect(invokeChannels.has('settings.get')).toBe(true);
    expect(invokeChannels.has('settings.update')).toBe(true);

    const sharedInvokes = new Set<string>(Object.values(IPC_CHANNELS.invoke));
    expect(sharedInvokes.has('settings.get')).toBe(true);
    expect(sharedInvokes.has('settings.update')).toBe(true);
  });

  it('registers settings handlers and applies startup control on get/update', () => {
    const source = readSource('src/main/ipc/register-handlers.ts');

    expect(/ipcMain\.handle\(\s*'settings\.get'/.test(source)).toBe(true);
    expect(/ipcMain\.handle\(\s*'settings\.update'/.test(source)).toBe(true);
    expect(/ipcMain\.handle\(\s*'settings\.importCityMap'/.test(source)).toBe(true);

    expect(source.includes('applyLoginItem(settingsPayload.settings.startOnBoot);')).toBe(true);
  });

  it('worker runtime persists app control keys through settings storage', () => {
    const source = readSource('src/core/worker-runtime.ts');

    expect(source.includes("startOnBoot: 'startOnBoot'")).toBe(true);
    expect(source.includes("backgroundAudio: 'backgroundAudio'")).toBe(true);
    expect(source.includes("quietHoursStart: 'quietHoursStart'")).toBe(true);
    expect(source.includes("quietHoursEnd: 'quietHoursEnd'")).toBe(true);
    expect(source.includes('case \'settings.update\':')).toBe(true);
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
  });
});
