import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type {
  AppHealth,
  EventChannel,
  EventPayloadMap,
  InvokePayloadMap,
  InvokeResultMap,
} from '../contracts/ipc';
import { DEFAULT_HEALTH } from '../contracts/ipc';
import type {
  WorkerBootstrapData,
  WorkerEvent,
  WorkerInvokeChannel,
  WorkerInvokePayloadMap,
  WorkerInvokeResultMap,
  WorkerMessage,
  WorkerRequest,
  WorkerResponse,
} from '@/shared/worker-protocol';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
  channel: WorkerInvokeChannel;
};

export const CORE_WORKER_HEALTH_INVOKE_TIMEOUT_MS = 4_000;
export const CORE_WORKER_DEFAULT_INVOKE_TIMEOUT_MS = 12_000;

export declare interface CoreWorkerClient {
  on<C extends EventChannel>(
    event: C,
    listener: (payload: EventPayloadMap[C]) => void,
  ): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

export class CoreWorkerClient extends EventEmitter {
  private readonly bootstrapData: WorkerBootstrapData;
  private worker: Worker | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private latestHealth: AppHealth = { ...DEFAULT_HEALTH };
  private stopRequested = false;
  private lastWorkerFailureReason: string | null = null;
  private lastWorkerFailureSource: AppHealth['errorSource'] = 'startup';

  constructor(bootstrapData: WorkerBootstrapData) {
    super();
    this.bootstrapData = bootstrapData;
  }

  start(): void {
    if (this.worker) {
      return;
    }

    this.stopRequested = false;
    const workerPath = this.resolveWorkerPath();
    if (!workerPath) {
      const reason = 'Core worker entry not found in packaged resources.';
      this.lastWorkerFailureReason = reason;
      this.lastWorkerFailureSource = 'packaging';
      this.markHealthDegraded();
      this.emit('error', new Error(reason));
      return;
    }

    const worker = new Worker(workerPath, {
      workerData: this.bootstrapData,
    });
    this.worker = worker;
    this.lastWorkerFailureReason = null;
    this.lastWorkerFailureSource = null;
    worker.on('message', (message: WorkerMessage) => {
      if (this.worker !== worker) {
        return;
      }
      this.handleMessage(message);
    });
    worker.on('error', (error) => {
      if (this.worker !== worker) {
        return;
      }
      this.lastWorkerFailureReason = error.message;
      this.lastWorkerFailureSource = classifyWorkerErrorSource(error.message);
      this.markHealthDegraded();
      this.flushPending(new Error(`Core worker error: ${error.message}`));
      this.emit('error', error);
    });
    worker.on('exit', (code) => {
      if (this.worker === worker) {
        this.worker = null;
      }

      const expectedStop = this.stopRequested;
      if (expectedStop) {
        this.stopRequested = false;
      }

      if (this.worker !== null) {
        return;
      }

      const reason = `Core worker exited with code ${code}`;
      this.lastWorkerFailureReason = reason;
      this.lastWorkerFailureSource =
        !expectedStop && code !== 0
          ? classifyWorkerErrorSource(reason)
          : 'startup';
      this.markHealthDegraded();
      this.flushPending(new Error(`Core worker exited with code ${code}`));
      if (!expectedStop && code !== 0) {
        this.emit('error', new Error(`Core worker exited with code ${code}`));
      }
    });
  }

  async stop(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (!worker) {
      return;
    }
    this.stopRequested = true;
    this.flushPending(new Error('Core worker stopped.'));
    await worker.terminate();
    this.markHealthDegraded();
  }

  isRunning(): boolean {
    return this.worker !== null;
  }

  invoke<C extends WorkerInvokeChannel>(
    channel: C,
    payload?: WorkerInvokePayloadMap[C],
  ): Promise<WorkerInvokeResultMap[C]> {
    const worker = this.worker;
    if (!worker) {
      if (channel === 'app.getHealth') {
        const fallback = this.getDegradedHealth();
        return Promise.resolve(fallback as WorkerInvokeResultMap[C]);
      }
      return Promise.reject(new Error('Core worker is not running.'));
    }

    return new Promise<WorkerInvokeResultMap[C]>((resolve, reject) => {
      const id = randomUUID();
      const timeoutMs =
        channel === 'app.getHealth'
          ? CORE_WORKER_HEALTH_INVOKE_TIMEOUT_MS
          : CORE_WORKER_DEFAULT_INVOKE_TIMEOUT_MS;
      const timeout = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }
        this.pending.delete(id);
        pending.reject(
          new Error(`Core worker invoke timeout after ${timeoutMs}ms: ${pending.channel}`),
        );
      }, timeoutMs);
      timeout.unref?.();

      this.pending.set(id, {
        resolve: (value) => resolve(value as WorkerInvokeResultMap[C]),
        reject,
        timeout,
        channel,
      });
      const message: WorkerRequest<C> = {
        kind: 'request',
        id,
        channel,
        payload,
      };
      worker.postMessage(message);
    });
  }

  private handleMessage(message: WorkerMessage): void {
    if (message.kind === 'event') {
      const event = message as WorkerEvent;
      if (event.channel === 'app.health') {
        this.latestHealth = event.payload as AppHealth;
      }
      this.emit(event.channel, event.payload);
      return;
    }

    const response = message as WorkerResponse;
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    clearTimeout(pending.timeout);
    if (response.ok) {
      if (response.channel === 'app.getHealth') {
        this.latestHealth = response.payload as AppHealth;
      }
      pending.resolve(response.payload);
    } else {
      if (response.channel === 'app.getHealth') {
        const fallback = this.getDegradedHealth();
        pending.resolve(fallback);
        return;
      }
      pending.reject(new Error(response.error));
    }
  }

  private getDegradedHealth(): AppHealth {
    const now = new Date().toISOString();
    const workerRunning = this.worker !== null;
    const fallbackDiagnostic =
      this.lastWorkerFailureReason ??
      (workerRunning
        ? 'Worker running but data feed is unavailable.'
        : 'Core worker is not running.');
    const errorSource =
      this.lastWorkerFailureSource ??
      (workerRunning ? 'worker' : 'startup');
    const shardActive = workerRunning ? Math.max(0, this.latestHealth.shardActive) : 0;
    const shardTotal = workerRunning ? Math.max(0, this.latestHealth.shardTotal) : 0;
    const subscribedTokens = workerRunning
      ? Math.max(0, this.latestHealth.subscribedTokens)
      : 0;
    const latencyMs = workerRunning ? Math.max(0, this.latestHealth.latencyMs) : 0;
    return {
      connected: false,
      mode: 'degraded',
      shardActive,
      shardTotal,
      subscribedTokens,
      reconnects: this.latestHealth.reconnects,
      latencyMs,
      droppedEvents: this.latestHealth.droppedEvents + 1,
      lastSyncAt: now,
      workerRunning,
      startupPhase: workerRunning ? 'degraded' : 'stopped',
      diagnostic: this.latestHealth.diagnostic ?? fallbackDiagnostic,
      errorSource,
      serviceStatus: {
        coreWorker: workerRunning ? 'error' : 'stopped',
        discovery: workerRunning ? 'error' : 'idle',
        websocket: 'disconnected',
        dataFreshness: 'unknown',
        activeShards: shardActive,
        totalShards: shardTotal,
        lagMs: latencyMs,
        lastUpdateAt: now,
        lastError: fallbackDiagnostic,
        lastErrorSource: errorSource,
      },
    };
  }

  private markHealthDegraded(): void {
    const degraded = this.getDegradedHealth();
    this.latestHealth = degraded;
    this.emit('app.health', degraded);
  }

  private flushPending(error: Error): void {
    if (this.pending.size === 0) {
      return;
    }
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id);
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }

  private resolveWorkerPath(): string | null {
    const candidates = [
      path.join(__dirname, 'worker.js'),
      path.join(process.resourcesPath, 'app.asar', '.vite', 'build', 'worker.js'),
      path.join(process.resourcesPath, 'app', '.vite', 'build', 'worker.js'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }
}

const classifyWorkerErrorSource = (message: string): AppHealth['errorSource'] => {
  const normalized = message.toLowerCase();
  if (
    normalized.includes('packaged resources') ||
    normalized.includes('cannot find module') ||
    normalized.includes('err_module_not_found')
  ) {
    return 'packaging';
  }
  if (
    normalized.includes('mask is not a function') ||
    normalized.includes('websocket') ||
    normalized.includes(' ws')
  ) {
    return 'ws';
  }
  if (
    normalized.includes('sqlite') ||
    normalized.includes('better-sqlite3') ||
    normalized.includes('database')
  ) {
    return 'db';
  }
  if (
    normalized.includes('discover') ||
    normalized.includes('gamma')
  ) {
    return 'discovery';
  }
  if (
    normalized.includes('econn') ||
    normalized.includes('enotfound') ||
    normalized.includes('etimedout') ||
    normalized.includes('network') ||
    normalized.includes('proxy') ||
    normalized.includes('tls')
  ) {
    return 'network';
  }
  return 'worker';
};

export type CoreInvokePayloadMap = InvokePayloadMap;
export type CoreInvokeResultMap = InvokeResultMap;
