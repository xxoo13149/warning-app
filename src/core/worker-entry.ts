import { parentPort, workerData } from 'node:worker_threads';

import type { WorkerBootstrapData, WorkerRequest } from '@/shared/worker-protocol';

const port = parentPort;

if (!port) {
  throw new Error('Worker runtime requires a parent port.');
}

// Stability-first mode: disable optional native acceleration modules in `ws`.
process.env.WS_NO_BUFFER_UTIL = '1';
process.env.WS_NO_UTF_8_VALIDATE = '1';

const bootstrap = async (): Promise<void> => {
  const { WorkerRuntime } = await import('./worker-runtime');
  const runtime = new WorkerRuntime(port, workerData as WorkerBootstrapData);

  void runtime.start().catch((error) => {
    console.error('[worker-entry] startup failed', error);
    process.exitCode = 1;
  });

  port.on('message', (message: WorkerRequest) => {
    if (!message || message.kind !== 'request') {
      return;
    }
    void runtime.handleRequest(message);
  });
};

void bootstrap().catch((error) => {
  console.error('[worker-entry] bootstrap failed', error);
  process.exitCode = 1;
});
