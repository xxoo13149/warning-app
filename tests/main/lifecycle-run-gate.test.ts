import { describe, expect, it } from 'vitest';

import { LifecycleRunGate } from '../../src/main/services/lifecycle-run-gate';

describe('LifecycleRunGate', () => {
  it('keeps only the latest startup generation current', () => {
    const gate = new LifecycleRunGate();

    const first = gate.beginRun();
    const second = gate.beginRun();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
    expect(gate.isShutdownRequested()).toBe(false);
  });

  it('invalidates an in-flight startup without marking full shutdown', () => {
    const gate = new LifecycleRunGate();
    const generation = gate.beginRun();

    gate.invalidate('monitor-stopping');

    expect(gate.isCurrent(generation)).toBe(false);
    expect(gate.isShutdownRequested()).toBe(false);
    expect(gate.getLastInvalidationReason()).toBe('monitor-stopping');
  });

  it('makes shutdown a terminal gate until a new explicit run starts', () => {
    const gate = new LifecycleRunGate();
    const generation = gate.beginRun();

    gate.invalidate('application-quitting', { shutdown: true });

    expect(gate.isCurrent(generation)).toBe(false);
    expect(gate.isShutdownRequested()).toBe(true);
    expect(gate.getLastInvalidationReason()).toBe('application-quitting');

    const next = gate.beginRun();
    expect(gate.isCurrent(next)).toBe(true);
    expect(gate.isShutdownRequested()).toBe(false);
  });
});
