import { app } from 'electron';
import started from 'electron-squirrel-startup';

import { bootstrapAppShell } from './app-shell';

if (started) {
  app.quit();
} else {
  void bootstrapAppShell();
}
