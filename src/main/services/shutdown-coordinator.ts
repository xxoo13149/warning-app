export interface ShutdownStep {
  name: string;
  run: () => Promise<void> | void;
}

export interface ShutdownCoordinatorOptions<T> {
  beginShutdown: () => T;
  getSteps: () => ShutdownStep[];
  requestQuit: () => void;
  forceExit: (exitCode: number) => void;
  forceExitDelayMs?: number;
}

export class ShutdownCoordinator<T> {
  private shutdownTask: Promise<T> | null = null;
  private stage: 'idle' | 'preparing' | 'ready' | 'finished' = 'idle';
  private forceExitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: ShutdownCoordinatorOptions<T>) {}

  public isShuttingDown(): boolean {
    return this.stage === 'preparing' || this.stage === 'ready';
  }

  public canQuitApp(): boolean {
    return this.stage === 'ready' || this.stage === 'finished';
  }

  public async requestShutdown(): Promise<T> {
    if (this.shutdownTask) {
      return this.shutdownTask;
    }

    this.stage = 'preparing';
    const stateSnapshot = this.options.beginShutdown();
    this.armForceExitTimer();

    this.shutdownTask = (async () => {
      for (const step of this.options.getSteps()) {
        try {
          await step.run();
        } catch (error) {
          console.error(`[shutdown:${step.name}]`, error);
        }
      }

      this.stage = 'ready';
      this.options.requestQuit();
      return stateSnapshot;
    })();

    return this.shutdownTask;
  }

  public markQuitComplete(): void {
    this.stage = 'finished';
    if (this.forceExitTimer) {
      clearTimeout(this.forceExitTimer);
      this.forceExitTimer = null;
    }
  }

  private armForceExitTimer(): void {
    if (this.forceExitTimer) {
      return;
    }

    this.forceExitTimer = setTimeout(() => {
      this.options.forceExit(0);
    }, this.options.forceExitDelayMs ?? 2_000);
    this.forceExitTimer.unref?.();
  }
}
