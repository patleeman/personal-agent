import { createWriteStream, type WriteStream } from 'node:fs';
import { join } from 'node:path';

import { resolveDesktopRuntimePaths } from './desktop-env.js';

let mainLogStream: WriteStream | null = null;

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

function writeLogLineToConsole(message: string): void {
  try {
    if (message.includes('[error]')) {
      console.error(message);
      return;
    }

    if (message.includes('[warn]')) {
      console.warn(message);
      return;
    }

    console.log(message);
  } catch {
    // Ignore console write failures; file logging should still proceed.
  }
}

export function writeDesktopMainLogLine(message: string): void {
  writeLogLineToConsole(message);

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
