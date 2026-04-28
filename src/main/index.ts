import { app } from 'electron';
import started from 'electron-squirrel-startup';

import { APP_NAME, APP_USER_MODEL_ID } from '../shared/constants';
import { bootstrapAppShell } from './app-shell';
import { prepareRuntimeStorage } from './services/runtime-storage';
import { appendRuntimeLog } from './services/runtime-log';
import { configureRuntimePaths } from './services/runtime-paths';

if (started) {
  app.quit();
} else {
  let initialRuntimePaths;
  try {
    app.setName(APP_NAME);
    app.setAppUserModelId(APP_USER_MODEL_ID);
    initialRuntimePaths = configureRuntimePaths(app);
  } catch (error) {
    console.error('[startup] failed to configure runtime paths before single-instance lock', error);
    appendRuntimeLog(
      'startup.log',
      '[main-index] Early runtime path configuration failed before single-instance lock.',
      error,
    );
    app.quit();
  }

  if (!initialRuntimePaths) {
    // Early runtime path setup already failed and initiated quit.
  } else if (!app.requestSingleInstanceLock()) {
    appendRuntimeLog(
      'startup.log',
      '[main-index] Duplicate instance detected after runtime path configuration; exiting second instance.',
      undefined,
      initialRuntimePaths.logsDir,
    );
    app.quit();
  } else {
    void (async () => {
      try {
        const { runtimePaths } = await prepareRuntimeStorage(app, initialRuntimePaths.dataRootDir);
        appendRuntimeLog(
          'startup.log',
          `[main-index] Runtime storage prepared. db=${runtimePaths.mainDbPath}`,
          undefined,
          runtimePaths.logsDir,
        );
        await bootstrapAppShell(runtimePaths);
      } catch (error) {
        console.error('[startup] failed to prepare runtime storage', error);
        appendRuntimeLog('startup.log', '[main-index] Startup bootstrap failed.', error);
        app.quit();
      }
    })();
  }
}
