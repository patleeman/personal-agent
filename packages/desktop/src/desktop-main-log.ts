import { createWriteStream, type WriteStream } from 'node:fs';
import { join } from 'node:path';

import type { WebContents } from 'electron';

import { resolveDesktopRuntimePaths } from './desktop-env.js';

let mainLogStream: WriteStream | null = null;
const browserConsoleTargets = new Set<WebContents>();

function getMainLogStream(): WriteStream | null {
  if (mainLogStream) {
    return mainLogStream;
  }

  try {
    mainLogStream = createWriteStream(join(resolveDesktopRuntimePaths().desktopLogsDir, 'main.log'), {
      flags: 'a',
      encoding: 'utf-8',
    });
    mainLogStream.on('error', () => {
      mainLogStream = null;
    });
    return mainLogStream;
  } catch {
    return null;
  }
}

type DesktopLogLevel = 'log' | 'warn' | 'error';

function getLogLevel(message: string): DesktopLogLevel {
  if (message.includes('[error]')) {
    return 'error';
  }

  if (message.includes('[warn]')) {
    return 'warn';
  }

  return 'log';
}

function writeLogLineToConsole(message: string, level: DesktopLogLevel): void {
  try {
    console[level](message);
  } catch {
    // Ignore console write failures; file logging should still proceed.
  }
}

function writeLogLineToBrowserConsoles(message: string, level: DesktopLogLevel): void {
  const expression = `console.${level}(${JSON.stringify(message)})`;

  for (const target of browserConsoleTargets) {
    if (target.isDestroyed()) {
      browserConsoleTargets.delete(target);
      continue;
    }

    void target.executeJavaScript(expression, true).catch(() => undefined);
  }
}

export function registerDesktopLogConsoleTarget(webContents: WebContents): () => void {
  browserConsoleTargets.add(webContents);

  const unregister = (): void => {
    browserConsoleTargets.delete(webContents);
  };
  webContents.once('destroyed', unregister);

  return unregister;
}

export function writeDesktopMainLogLine(message: string): void {
  const level = getLogLevel(message);
  writeLogLineToConsole(message, level);
  writeLogLineToBrowserConsoles(message, level);

  const stream = getMainLogStream();
  if (!stream) {
    return;
  }

  stream.write(`${message}\n`);
}

export async function closeDesktopMainLog(): Promise<void> {
  if (!mainLogStream) {
    return;
  }

  const stream = mainLogStream;
  mainLogStream = null;
  await new Promise<void>((resolve) => stream.end(resolve));
}
