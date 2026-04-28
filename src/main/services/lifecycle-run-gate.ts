export class LifecycleRunGate {
  private generation = 0;
  private shutdownRequested = false;
  private lastInvalidationReason: string | null = null;

  public beginRun(): number {
    this.generation += 1;
    this.shutdownRequested = false;
    this.lastInvalidationReason = null;
    return this.generation;
  }

  public invalidate(reason: string, options?: { shutdown?: boolean }): number {
    this.generation += 1;
    this.lastInvalidationReason = reason;
    if (options?.shutdown) {
      this.shutdownRequested = true;
    }
    return this.generation;
  }

  public isCurrent(generation: number): boolean {
    return generation === this.generation && !this.shutdownRequested;
  }

  public isShutdownRequested(): boolean {
    return this.shutdownRequested;
  }

  public getLastInvalidationReason(): string | null {
    return this.lastInvalidationReason;
  }
}
