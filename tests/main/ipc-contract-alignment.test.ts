import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { EVENT_CHANNELS, INVOKE_CHANNELS } from '../../src/main/contracts/ipc';
import { IPC_CHANNELS } from '../../src/shared/constants';

const hookInvokeChannels = [
  'app.getHealth',
  'app.getControlState',
  'app.control',
  'dashboard.query',
  'markets.query',
  'alerts.list',
  'alerts.ack',
  'rules.list',
  'rules.save',
  'settings.get',
  'settings.update',
  'settings.importCityMap',
  'settings.pickSound',
] as const;

const hookEventChannels = [
  'app.health',
  'app.controlState',
  'dashboard.tick',
  'markets.tick',
  'alerts.new',
] as const;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('ipc contract alignment', () => {
  it('keeps renderer invoke channels in main invoke contract', () => {
    const mainInvoke = new Set<string>(INVOKE_CHANNELS);
    hookInvokeChannels.forEach((channel) => {
      expect(mainInvoke.has(channel)).toBe(true);
    });
  });

  it('keeps renderer event channels in main event contract', () => {
    const mainEvents = new Set<string>(EVENT_CHANNELS);
    hookEventChannels.forEach((channel) => {
      expect(mainEvents.has(channel)).toBe(true);
    });
  });

  it('registers main handlers and event forwarding for all hook channels', () => {
    const registerHandlerSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/main/ipc/register-handlers.ts'),
      'utf-8',
    );
    const appShellSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/main/app-shell.ts'),
      'utf-8',
    );

    hookInvokeChannels.forEach((channel) => {
      const pattern = new RegExp(`ipcMain\\.handle\\(\\s*'${escapeRegExp(channel)}'`);
      expect(pattern.test(registerHandlerSource)).toBe(true);
    });

    hookEventChannels.forEach((channel) => {
      if (channel === 'app.controlState') {
        const pattern = new RegExp(`emitEvent\\(\\s*'${escapeRegExp(channel)}'`);
        expect(pattern.test(appShellSource)).toBe(true);
        return;
      }

      const subscribePattern = new RegExp(`coreClient\\.on\\(\\s*'${escapeRegExp(channel)}'`);
      const emitPattern = new RegExp(`emitEvent\\(\\s*'${escapeRegExp(channel)}'`);
      expect(subscribePattern.test(registerHandlerSource)).toBe(true);
      expect(emitPattern.test(registerHandlerSource)).toBe(true);
    });
  });

  it('exposes preload aliases used by renderer bridge detection', () => {
    const content = fs.readFileSync(
      path.resolve(process.cwd(), 'src/main/preload-bridge.ts'),
      'utf-8',
    );
    expect(content).toContain(`exposeInMainWorld('warningApi', api)`);
    expect(content).toContain(`exposeInMainWorld('electronAPI', api)`);
    expect(content).toContain(`exposeInMainWorld('api', api)`);
  });

  it('keeps shared channel constants synced with main contracts', () => {
    const sharedInvoke = new Set<string>(Object.values(IPC_CHANNELS.invoke));
    hookInvokeChannels.forEach((channel) => {
      expect(sharedInvoke.has(channel)).toBe(true);
    });

    const sharedEvents = new Set<string>(Object.values(IPC_CHANNELS.events));
    hookEventChannels.forEach((channel) => {
      expect(sharedEvents.has(channel)).toBe(true);
    });
  });
});
