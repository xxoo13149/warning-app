import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { createRuntimeDiagnosticsPackage } from '../../src/main/services/runtime-diagnostics';
import { resolveRuntimePaths } from '../../src/main/services/runtime-paths';
import type {
  RuntimeDiagnosticsPackage,
  RuntimeMemoryTelemetry,
} from '../../src/shared/monitor-contracts';

describe('runtime diagnostics package', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const directoryPath of tempDirs.splice(0)) {
      fs.rmSync(directoryPath, { recursive: true, force: true });
    }
  });

  it('writes a json package with runtime paths, storage summary, generated time, and recent log tails', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-diagnostics-'));
    tempDirs.push(tempRoot);
    const runtimePaths = resolveRuntimePaths(tempRoot);
    const generatedAt = new Date('2026-04-25T09:30:00.000Z');
    const memoryTelemetry = createMemoryTelemetrySample(generatedAt.toISOString());

    seedRuntimeMainDatabase(runtimePaths.mainDbPath, 'SECRET_MAIN_DB_PAYLOAD');
    writeLogFile(
      path.join(runtimePaths.logsDir, 'older.log'),
      'older log line\n',
      new Date('2026-04-25T08:00:00.000Z'),
    );
    writeLogFile(
      path.join(runtimePaths.logsDir, 'latest.log'),
      'latest log header\nlatest log detail\nlatest log tail\n',
      new Date('2026-04-25T09:00:00.000Z'),
    );

    const result = createRuntimeDiagnosticsPackage(runtimePaths, {
      now: () => generatedAt,
      logFileLimit: 1,
      logTailBytes: 24,
      memoryTelemetry,
    });

    expect(fs.existsSync(result.packagePath)).toBe(true);
    expect(result.packagePath).toBe(
      path.join(tempRoot, 'diagnostics', 'runtime-diagnostics-20260425-093000.json'),
    );

    const packageText = fs.readFileSync(result.packagePath, 'utf8');
    const diagnostics = JSON.parse(packageText) as RuntimeDiagnosticsPackage;

    expect(diagnostics.generatedAt).toBe(generatedAt.toISOString());
    expect(diagnostics.runtimePaths).toEqual(runtimePaths);
    expect(diagnostics.storageSummary.mainDbPath).toBe(runtimePaths.mainDbPath);
    expect(diagnostics.storageSummary.mainDbExists).toBe(true);
    expect(diagnostics.storageSummary.priceTickCount).toBe(1);
    expect(diagnostics.memoryTelemetry).toEqual(memoryTelemetry);
    expect(diagnostics.logs.directory).toBe(runtimePaths.logsDir);
    expect(diagnostics.logs.fileCount).toBe(2);
    expect(diagnostics.logs.includedFileCount).toBe(1);
    expect(diagnostics.logs.files[0]).toMatchObject({
      relativePath: 'latest.log',
      truncated: true,
    });
    expect(diagnostics.logs.files[0]?.tail).toContain('latest log tail');
    expect(diagnostics.privacy.excludes).toContain('main.sqlite contents');
  });

  it('does not embed the runtime main sqlite contents in the diagnostics package', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-diagnostics-private-'));
    tempDirs.push(tempRoot);
    const runtimePaths = resolveRuntimePaths(tempRoot);
    const mainDbSecret = 'SECRET_MAIN_DB_PAYLOAD_SHOULD_NOT_LEAK';

    seedRuntimeMainDatabase(runtimePaths.mainDbPath, mainDbSecret);
    writeLogFile(
      path.join(runtimePaths.logsDir, 'runtime.log'),
      'safe log line\n',
      new Date('2026-04-25T10:00:00.000Z'),
    );

    const result = createRuntimeDiagnosticsPackage(runtimePaths, {
      now: () => new Date('2026-04-25T10:30:00.000Z'),
    });

    const packageText = fs.readFileSync(result.packagePath, 'utf8');
    const diagnostics = JSON.parse(packageText) as RuntimeDiagnosticsPackage;
    expect(packageText).not.toContain(mainDbSecret);
    expect(diagnostics.runtimePaths.mainDbPath).toBe(runtimePaths.mainDbPath);
    expect(fs.readdirSync(path.dirname(result.packagePath))).toEqual([
      'runtime-diagnostics-20260425-103000.json',
    ]);
  });
});

const createMemoryTelemetrySample = (sampledAt: string): RuntimeMemoryTelemetry => ({
  sampledAt,
  browser: {
    sampledAt,
    pid: 100,
    creationTime: 1,
    cpuPercent: 0.5,
    processMemory: {
      privateKb: 120,
      residentSetKb: 240,
      sharedKb: 60,
    },
    appMetrics: {
      workingSetKb: 300,
      peakWorkingSetKb: 360,
      privateBytesKb: 180,
    },
  },
  tabs: [
    {
      sampledAt,
      pid: 200,
      name: 'Renderer',
      serviceName: null,
      creationTime: 2,
      cpuPercent: 1.2,
      sandboxed: false,
      integrityLevel: 'medium',
      memory: {
        workingSetKb: 210,
        peakWorkingSetKb: 260,
        privateBytesKb: 170,
      },
    },
  ],
  renderer: {
    sampledAt,
    pid: 200,
    webContentsId: 1,
    browserWindowId: 1,
    url: 'file:///renderer/index.html',
    title: 'Warning App',
    hidden: false,
    visibilityState: 'visible',
    processMemory: {
      privateKb: 150,
      residentSetKb: 190,
      sharedKb: 25,
    },
    blinkMemory: {
      allocatedKb: 90,
      totalKb: 120,
    },
    appMetrics: {
      workingSetKb: 210,
      peakWorkingSetKb: 260,
      privateBytesKb: 170,
    },
    cpuPercent: 1.2,
    creationTime: 2,
  },
});

const seedRuntimeMainDatabase = (dbPath: string, secret: string): void => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE price_ticks (
        timestamp INTEGER NOT NULL
      );
      CREATE TABLE alert_events (
        triggered_at INTEGER NOT NULL
      );
      CREATE TABLE latest_token_state (
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE app_settings (
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE secret_payload (
        value TEXT NOT NULL
      );
      INSERT INTO price_ticks (timestamp) VALUES (1777110000000);
      INSERT INTO alert_events (triggered_at) VALUES (1777110100000);
      INSERT INTO latest_token_state (updated_at) VALUES (1777110200000);
      INSERT INTO app_settings (updated_at) VALUES (1777110300000);
    `);
    db.prepare('INSERT INTO secret_payload (value) VALUES (?)').run(secret);
  } finally {
    db.close();
  }
};

const writeLogFile = (filePath: string, content: string, modifiedAt: Date): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  fs.utimesSync(filePath, modifiedAt, modifiedAt);
};
