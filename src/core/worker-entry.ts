import { parentPort, workerData } from 'node:worker_threads';

import type { WorkerBootstrapData, WorkerRequest } from '@/shared/worker-protocol';

const port = parentPort;

if (!port) {
  throw new Error('Worker runtime requires a parent port.');
}

// Stability-first mode: disable optional native acceleration modules in `ws`.
process.env.WS_NO_BUFFER_UTIL = '1';
process.env.WS_NO_UTF_8_VALIDATE = '1';

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const failWorkerStartup = (label: string, error: unknown): void => {
  const normalizedError = toError(error);
  console.error(label, normalizedError);
  port.close();
  queueMicrotask(() => {
    throw normalizedError;
  });
};

const bootstrap = async (): Promise<void> => {
  const { WorkerRuntime } = await import('./worker-runtime');
  const runtime = new WorkerRuntime(port, workerData as WorkerBootstrapData);
  let startupFailed = false;

  port.on('message', (message: WorkerRequest) => {
    if (startupFailed || !message || message.kind !== 'request') {
      return;
    }
    void runtime.handleRequest(message);
  });

  void runtime.start().catch((error) => {
    startupFailed = true;
    failWorkerStartup('[worker-entry] startup failed', error);
  });
};

void bootstrap().catch((error) => {
  failWorkerStartup('[worker-entry] bootstrap failed', error);
});
