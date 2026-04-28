import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShutdownCoordinator } from '../../src/main/services/shutdown-coordinator';

describe('ShutdownCoordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs shutdown once and reuses the same promise for repeated requests', async () => {
    const order: string[] = [];
    const beginShutdown = vi.fn(() => {
      order.push('begin');
      return 'snapshot';
    });
    const requestQuit = vi.fn(() => {
      order.push('quit');
    });
    const forceExit = vi.fn();
    const coordinator = new ShutdownCoordinator<string>({
      beginShutdown,
      getSteps: () => [
        {
          name: 'notifications',
          run: () => {
            order.push('notifications');
          },
        },
        {
          name: 'core-worker',
          run: async () => {
            order.push('core-worker');
          },
        },
      ],
      requestQuit,
      forceExit,
      forceExitDelayMs: 1_000,
    });

    const firstRequest = coordinator.requestShutdown();
    const secondRequest = coordinator.requestShutdown();

    await expect(firstRequest).resolves.toBe('snapshot');
    await expect(secondRequest).resolves.toBe('snapshot');
    expect(beginShutdown).toHaveBeenCalledTimes(1);
    expect(requestQuit).toHaveBeenCalledTimes(1);
    expect(forceExit).not.toHaveBeenCalled();
    expect(order).toEqual(['begin', 'notifications', 'core-worker', 'quit']);
    expect(coordinator.isShuttingDown()).toBe(true);
    expect(coordinator.canQuitApp()).toBe(true);
  });

  it('clears the force-exit timer once quit completes', async () => {
    vi.useFakeTimers();

    const forceExit = vi.fn();
    const coordinator = new ShutdownCoordinator<string>({
      beginShutdown: () => 'snapshot',
      getSteps: () => [],
      requestQuit: vi.fn(),
      forceExit,
      forceExitDelayMs: 100,
    });

    await coordinator.requestShutdown();
    coordinator.markQuitComplete();
    await vi.advanceTimersByTimeAsync(150);

    expect(forceExit).not.toHaveBeenCalled();
    expect(coordinator.canQuitApp()).toBe(true);
  });
});
