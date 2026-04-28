import { describe, expect, it } from 'vitest';

import { buildBubbleLayout } from '../../src/renderer/components/zip/BubbleChart';
import type { PhysicsBubbleCityData } from '../../src/renderer/utils/dashboard-bubble-adapter';

const buildPhysicsRow = (
  id: string,
  visualRadius: number,
): PhysicsBubbleCityData => ({
  id,
  cityKey: id.split('::')[1] ?? id,
  eventDate: id.split('::')[0] ?? '2026-04-15',
  name: id,
  code: 'TEST',
  region: 'NA',
  riskLevel: 80,
  visualRadius,
});

const snapshotLayout = (layout: Map<string, { x: number; y: number }>) =>
  [...layout.entries()]
    .map(([id, placement]) => `${id}:${placement.x.toFixed(2)}:${placement.y.toFixed(2)}`)
    .sort((left, right) => left.localeCompare(right));

describe('BubbleChart layout', () => {
  it('changes placements when the layout key changes', () => {
    const rows = [
      buildPhysicsRow('2026-04-15::london', 42),
      buildPhysicsRow('2026-04-15::beijing', 38),
      buildPhysicsRow('2026-04-15::seattle', 34),
    ];

    const firstLayout = buildBubbleLayout(rows, 960, 640, {
      layoutKey: 'layout-a',
      collisionPadding: 12,
    });
    const secondLayout = buildBubbleLayout(rows, 960, 640, {
      layoutKey: 'layout-b',
      collisionPadding: 12,
    });

    expect(snapshotLayout(firstLayout)).not.toEqual(snapshotLayout(secondLayout));
  });

  it('reserves collision padding in narrow layouts', () => {
    const row = buildPhysicsRow('2026-04-15::london', 30);
    const layout = buildBubbleLayout([row], 120, 120, {
      layoutKey: 'narrow',
      collisionPadding: 20,
    });
    const placement = layout.get(row.id);

    expect(placement).toBeDefined();
    expect(placement?.x).toBe(68);
    expect(placement?.y).toBe(68);
    expect(placement?.driftRangeX).toBe(0);
    expect(placement?.driftRangeY).toBe(0);
  });

  it('keeps planned drift inside the collision-safe viewport when space is available', () => {
    const rows = [
      buildPhysicsRow('2026-04-15::london', 42),
      buildPhysicsRow('2026-04-15::beijing', 38),
      buildPhysicsRow('2026-04-15::seattle', 34),
      buildPhysicsRow('2026-04-15::tokyo', 28),
    ];
    const collisionPadding = 14;
    const width = 720;
    const height = 460;
    const layout = buildBubbleLayout(rows, width, height, {
      layoutKey: 'safe-drift',
      collisionPadding,
    });

    for (const row of rows) {
      const placement = layout.get(row.id);
      expect(placement).toBeDefined();
      const inset = row.visualRadius + collisionPadding + 16;

      expect(placement!.anchorX - placement!.driftRangeX).toBeGreaterThanOrEqual(inset);
      expect(placement!.anchorX + placement!.driftRangeX).toBeLessThanOrEqual(width - inset);
      expect(placement!.anchorY - placement!.driftRangeY).toBeGreaterThanOrEqual(inset);
      expect(placement!.anchorY + placement!.driftRangeY).toBeLessThanOrEqual(height - inset);
    }

    for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
        const left = rows[leftIndex];
        const right = rows[rightIndex];
        const leftPlacement = layout.get(left.id);
        const rightPlacement = layout.get(right.id);

        expect(leftPlacement).toBeDefined();
        expect(rightPlacement).toBeDefined();
        const distance = Math.hypot(
          leftPlacement!.x - rightPlacement!.x,
          leftPlacement!.y - rightPlacement!.y,
        );
        expect(distance).toBeGreaterThanOrEqual(
          left.visualRadius + right.visualRadius + collisionPadding * 2,
        );
      }
    }
  });

  it('skips invalid radii instead of poisoning the whole layout', () => {
    const rows = [
      buildPhysicsRow('2026-04-15::valid', 30),
      buildPhysicsRow('2026-04-15::nan', Number.NaN),
      buildPhysicsRow('2026-04-15::infinity', Number.POSITIVE_INFINITY),
    ];
    const layout = buildBubbleLayout(rows, 420, 280, {
      layoutKey: 'invalid-radius',
      collisionPadding: 12,
    });

    expect(layout.has('2026-04-15::valid')).toBe(true);
    expect(layout.has('2026-04-15::nan')).toBe(false);
    expect(layout.has('2026-04-15::infinity')).toBe(false);
    const placement = layout.get('2026-04-15::valid');
    expect(Number.isFinite(placement?.x)).toBe(true);
    expect(Number.isFinite(placement?.y)).toBe(true);
  });
});
