import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';

interface DesktopScreenshotImage {
  name?: string;
  mimeType: string;
  data: string;
}

export interface DesktopScreenshotCaptureResult {
  cancelled: boolean;
  image?: DesktopScreenshotImage;
}

interface ScreenshotCommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

interface CaptureDesktopScreenshotDeps {
  platform: NodeJS.Platform;
  tmpdir: () => string;
  mkdtemp: typeof mkdtemp;
  readFile: typeof readFile;
  rm: typeof rm;
  runInteractiveScreencapture: (outputPath: string) => Promise<ScreenshotCommandResult>;
}

const defaultDeps: CaptureDesktopScreenshotDeps = {
  platform: process.platform,
  tmpdir,
  mkdtemp,
  readFile,
  rm,
  runInteractiveScreencapture,
};

export async function captureDesktopScreenshot(
  deps: CaptureDesktopScreenshotDeps = defaultDeps,
): Promise<DesktopScreenshotCaptureResult> {
  if (deps.platform !== 'darwin') {
    throw new Error('Built-in screenshot capture is currently only available on macOS.');
  }

  const tempDir = await deps.mkdtemp(join(deps.tmpdir(), 'personal-agent-screenshot-'));
  const fileName = `Screenshot ${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  const outputPath = join(tempDir, fileName);

  try {
    const result = await deps.runInteractiveScreencapture(outputPath);
    const imageBytes = await deps.readFile(outputPath).catch((error) => {
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
        return null;
      }
      throw error;
    });

    if (imageBytes && imageBytes.length > 0) {
      return {
        cancelled: false,
        image: {
          name: basename(outputPath),
          mimeType: 'image/png',
          data: imageBytes.toString('base64'),
        },
      };
    }

    if (result.signal) {
      throw new Error(`Screenshot capture was interrupted (${result.signal}).`);
    }

    const stderr = result.stderr.trim();
    if (result.code === 1 && stderr.length === 0) {
      return { cancelled: true };
    }

    if (/not authorized|not permitted|permission/i.test(stderr)) {
      throw new Error('macOS blocked screenshot capture. Enable Screen Recording for Personal Agent in System Settings and try again.');
    }

    if (stderr.length > 0) {
      throw new Error(stderr);
    }

    if (result.code === 0) {
      return { cancelled: true };
    }

    throw new Error(`Screenshot capture failed with exit code ${String(result.code)}.`);
  } finally {
    await deps.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runInteractiveScreencapture(outputPath: string): Promise<ScreenshotCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('screencapture', ['-i', '-U', '-x', outputPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (chunk: string | Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      const normalized = (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? new Error('macOS screencapture is unavailable on this machine.')
        : error;
      reject(normalized);
    });
    child.once('close', (code, signal) => {
      resolve({ code, signal, stderr });
    });
  });
}
