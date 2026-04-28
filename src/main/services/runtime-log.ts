import fs from 'node:fs';
import path from 'node:path';

import { FIXED_RUNTIME_DATA_ROOT } from './runtime-paths';

const DEFAULT_LOG_DIR = path.win32.join(FIXED_RUNTIME_DATA_ROOT, 'logs');

const normalizeError = (error: unknown): string | null => {
  if (error instanceof Error) {
    return error.stack?.trim() || error.message.trim() || error.name;
  }
  if (typeof error === 'string') {
    return error.trim() || null;
  }
  if (error === null || error === undefined) {
    return null;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export const resolveRuntimeLogDirFromDbPath = (dbPath: string): string => {
  const normalizedDbPath = path.win32.normalize(dbPath);
  return path.win32.join(path.win32.dirname(path.win32.dirname(normalizedDbPath)), 'logs');
};

export const appendRuntimeLog = (
  fileName: string,
  message: string,
  error?: unknown,
  logDir: string = DEFAULT_LOG_DIR,
): void => {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const timestamp = new Date().toISOString();
    const errorText = normalizeError(error);
    const lines = [`[${timestamp}] ${message}`];
    if (errorText) {
      lines.push(errorText);
    }
    fs.appendFileSync(path.join(logDir, fileName), `${lines.join('\n')}\n`, 'utf8');
  } catch {
    // Logging must never break startup.
  }
};

export const createRuntimeLogger = (
  fileName: string,
  logDir: string = DEFAULT_LOG_DIR,
  context?: string,
): ((message: string, error?: unknown) => void) =>
  (message, error) => {
    const formattedMessage = context ? `[${context}] ${message}` : message;
    appendRuntimeLog(fileName, formattedMessage, error, logDir);
  };
