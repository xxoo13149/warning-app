import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { WeatherMonitorRepository } from '../../src/core/db/repository';
import type { AlertRule } from '../../src/core/alerts/types';

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

describe('WeatherMonitorRepository alert rules', () => {
  it('round-trips abnormal lottery rules without collapsing them into spread rules', () => {
    const repository = createRepository();

    repository.upsertAlertRules([
      buildRule({
        id: 'abnormal-lottery',
        name: 'Abnormal lottery',
        isBuiltin: true,
        builtinKey: 'abnormal_lottery',
        metric: 'abnormal_lottery',
        operator: '>=',
        threshold: 0.03,
        windowSec: 90,
        cooldownSec: 180,
        dedupeWindowSec: 60,
        bubbleWeight: 85,
      }),
    ]);

    const [storedRule] = repository.queryAlertRules(false);

    expect(storedRule?.id).toBe('abnormal-lottery');
    expect(storedRule?.builtinKey).toBe('abnormal_lottery');
    expect(storedRule?.metric).toBe('abnormal_lottery');
    expect(storedRule?.operator).toBe('>=');
  });
});

const createRepository = () => {
  const root = path.join(tmpdir(), `warning-app-alert-rules-${randomUUID()}`);
  const dbPath = path.join(root, 'main.sqlite');
  tempRoots.push(root);

  const repository = new WeatherMonitorRepository({ dbPath });
  repositories.push(repository);
  repository.init();
  return repository;
};

const buildRule = (overrides: Partial<AlertRule> = {}): AlertRule => ({
  id: overrides.id ?? 'rule-1',
  name: overrides.name ?? 'Spread guard',
  isBuiltin: overrides.isBuiltin ?? false,
  builtinKey: overrides.builtinKey,
  metric: overrides.metric ?? 'spread_threshold',
  operator: overrides.operator ?? '>',
  threshold: overrides.threshold ?? 0.05,
  windowSec: overrides.windowSec ?? 60,
  cooldownSec: overrides.cooldownSec ?? 120,
  dedupeWindowSec: overrides.dedupeWindowSec ?? 60,
  bubbleWeight: overrides.bubbleWeight ?? 60,
  severity: overrides.severity ?? 'medium',
  enabled: overrides.enabled ?? true,
  soundProfileId: overrides.soundProfileId ?? '',
  liquiditySide: overrides.liquiditySide,
  scope: overrides.scope ?? {},
  quietHours: overrides.quietHours,
});
