import { describe, expect, it } from 'vitest';
import { AlertEngine, type AlertRule } from '../../src/core/alerts';
import { MarketStateStore } from '../../src/core/state';

describe('feed stale alerts', () => {
  it('triggers when feed lag exceeds threshold', () => {
    const engine = new AlertEngine(new MarketStateStore());
    const rule: AlertRule = {
      id: 'rule-feed',
      name: 'Feed stale over 30s',
      enabled: true,
      metric: 'feed_stale',
      operator: '>=',
      threshold: 30,
      windowSec: 30,
      cooldownSec: 10,
      dedupeWindowSec: 5,
      severity: 'critical',
    };

    const now = Date.UTC(2026, 0, 1, 0, 2, 0);
    const events = engine.evaluateFeedHealth(
      [rule],
      {
        feedKey: 'market-ws-shard-1',
        status: 'degraded',
        lastMessageAt: now - 45_000,
        updatedAt: now,
      },
      now,
    );

    expect(events.length).toBe(1);
    expect(events[0]?.ruleId).toBe('rule-feed');
  });
});
