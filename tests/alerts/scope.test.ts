import { describe, expect, it } from 'vitest';
import { isInQuietHours, matchesScope } from '../../src/core/alerts/scope';

describe('scope matching', () => {
  it('matches global scope and fails mismatched scoped fields', () => {
    expect(
      matchesScope(undefined, {
        cityKey: 'nyc',
        marketId: 'market-1',
        tokenId: 'token-1',
      }),
    ).toBe(true);

    expect(
      matchesScope(
        {
          cityKey: 'nyc',
          marketId: 'market-1',
        },
        {
          cityKey: 'nyc',
          marketId: 'market-1',
        },
      ),
    ).toBe(true);

    expect(
      matchesScope(
        {
          cityKey: 'sfo',
        },
        {
          cityKey: 'nyc',
        },
      ),
    ).toBe(false);
  });
});

describe('quiet hours', () => {
  it('supports cross-midnight quiet hours', () => {
    const at2300Utc = Date.UTC(2026, 0, 1, 23, 0, 0);
    const at1000Utc = Date.UTC(2026, 0, 1, 10, 0, 0);

    expect(
      isInQuietHours(
        {
          startMinute: 22 * 60,
          endMinute: 7 * 60,
        },
        at2300Utc,
        0,
      ),
    ).toBe(true);

    expect(
      isInQuietHours(
        {
          startMinute: 22 * 60,
          endMinute: 7 * 60,
        },
        at1000Utc,
        0,
      ),
    ).toBe(false);
  });
});
