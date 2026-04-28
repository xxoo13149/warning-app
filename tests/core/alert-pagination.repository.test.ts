import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AlertTrigger } from '../../src/core/alerts/types';
import { WeatherMonitorRepository } from '../../src/core/db/repository';

const tempRoots: string[] = [];
const repositories: WeatherMonitorRepository[] = [];

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    repository.close();
  }

  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('WeatherMonitorRepository alert pagination', () => {
  it('returns total/hasMore/nextCursor and uses id as the tie-breaker for matching timestamps', () => {
    const repository = createRepository();
    const latestTime = Date.UTC(2026, 3, 24, 8, 30, 0);
    const sharedTime = latestTime - 60_000;
    const oldestTime = latestTime - 120_000;

    repository.insertAlertEvents([
      buildAlertTrigger('alert-z', latestTime),
      buildAlertTrigger('alert-y', sharedTime),
      buildAlertTrigger('alert-x', sharedTime),
      buildAlertTrigger('alert-a', oldestTime),
    ]);

    const firstPage = repository.queryAlertEvents({ limit: 2 });
    const secondPage = repository.queryAlertEvents({
      limit: 2,
      cursor: firstPage.nextCursor,
    });

    expect(firstPage.total).toBe(4);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.rows.map((row) => row.id)).toEqual(['alert-z', 'alert-y']);
    expect(firstPage.nextCursor).toEqual({
      triggeredAt: sharedTime,
      id: 'alert-y',
    });

    expect(secondPage.total).toBe(4);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.rows.map((row) => row.id)).toEqual(['alert-x', 'alert-a']);
    expect(secondPage.nextCursor).toEqual({
      triggeredAt: oldestTime,
      id: 'alert-a',
    });
  });

  it('filters acknowledged rows out of the total and page results', () => {
    const repository = createRepository();
    const baseTime = Date.UTC(2026, 3, 24, 9, 0, 0);

    repository.insertAlertEvents([
      buildAlertTrigger('alert-c', baseTime),
      buildAlertTrigger('alert-b', baseTime - 60_000),
      buildAlertTrigger('alert-a', baseTime - 120_000),
    ]);
    repository.acknowledgeAlertEvent('alert-b');

    const unacknowledged = repository.queryAlertEvents({
      acknowledged: false,
      limit: 10,
    });
    const acknowledged = repository.queryAlertEvents({
      acknowledged: true,
      limit: 10,
    });

    expect(unacknowledged.total).toBe(2);
    expect(unacknowledged.rows.map((row) => row.id)).toEqual(['alert-c', 'alert-a']);
    expect(unacknowledged.hasMore).toBe(false);

    expect(acknowledged.total).toBe(1);
    expect(acknowledged.rows.map((row) => row.id)).toEqual(['alert-b']);
    expect(acknowledged.hasMore).toBe(false);
  });

  it('keeps cursor pagination stable across repeated requests', () => {
    const repository = createRepository();
    const baseTime = Date.UTC(2026, 3, 24, 10, 0, 0);

    repository.insertAlertEvents([
      buildAlertTrigger('alert-e', baseTime),
      buildAlertTrigger('alert-d', baseTime - 60_000),
      buildAlertTrigger('alert-c', baseTime - 60_000),
      buildAlertTrigger('alert-b', baseTime - 120_000),
      buildAlertTrigger('alert-a', baseTime - 180_000),
    ]);

    const firstPage = repository.queryAlertEvents({ limit: 2 });
    const cursor = firstPage.nextCursor;
    const secondPage = repository.queryAlertEvents({ limit: 2, cursor });
    const repeatedSecondPage = repository.queryAlertEvents({ limit: 2, cursor });

    expect(cursor).toEqual({
      triggeredAt: baseTime - 60_000,
      id: 'alert-d',
    });
    expect(secondPage).toEqual(repeatedSecondPage);
    expect(firstPage.rows.map((row) => row.id)).toEqual(['alert-e', 'alert-d']);
    expect(secondPage.rows.map((row) => row.id)).toEqual(['alert-c', 'alert-b']);
    expect(secondPage.hasMore).toBe(true);
    expect(secondPage.nextCursor).toEqual({
      triggeredAt: baseTime - 120_000,
      id: 'alert-b',
    });
  });
});

const createRepository = () => {
  const root = path.join(tmpdir(), `warning-app-alert-pagination-${randomUUID()}`);
  const dbPath = path.join(root, 'main.sqlite');
  tempRoots.push(root);

  const repository = new WeatherMonitorRepository({ dbPath });
  repositories.push(repository);
  repository.init();
  return repository;
};

const buildAlertTrigger = (
  id: string,
  triggeredAt: number,
  overrides: Partial<AlertTrigger> = {},
): AlertTrigger => ({
  id,
  ruleId: 'rule-1',
  triggeredAt,
  message: `message-${id}`,
  severity: 'medium',
  dedupeKey: id,
  cityKey: 'la',
  marketId: 'market-1',
  tokenId: `token-${id}`,
  ...overrides,
});
