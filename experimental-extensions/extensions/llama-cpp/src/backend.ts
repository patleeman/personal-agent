import { createWriteStream } from 'node:fs';
import { access, chmod, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { get } from 'node:https';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ExtensionBackendContext } from '@personal-agent/extensions';

type DownloadModelInput = {
  repo?: string;
  filename?: string;
};

type RunPromptInput = {
  modelPath?: string;
  prompt?: string;
  contextSize?: number;
  gpuLayers?: number;
};

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(here, '..');
const bundledCli = join(extensionRoot, 'bin', 'darwin-arm64', 'llama-cli');
const modelCacheRoot = join(homedir(), '.cache', 'personal-agent', 'llama-cpp', 'models');

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runProcess(
  ctx: ExtensionBackendContext,
  command: string,
  args: string[],
  options?: { timeoutMs?: number; maxBuffer?: number },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const result = await ctx.shell.exec({ command, args, timeoutMs: options?.timeoutMs, maxBuffer: options?.maxBuffer });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { exitCode: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
  }
}

function download(url: string, destination: string, redirects = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      const statusCode = response.statusCode ?? 0;
      const location = response.headers.location;

      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        if (redirects > 5) {
          reject(new Error('Too many redirects while downloading model.'));
          return;
        }
        download(new URL(location, url).toString(), destination, redirects + 1).then(resolve, reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Model download failed with HTTP ${statusCode}.`));
        return;
      }

      const file = createWriteStream(destination);
      response.pipe(file);
      file.on('finish', () => file.close((error) => (error ? reject(error) : resolve())));
      file.on('error', reject);
    });

    request.on('error', reject);
  });
}

export async function runtimeStatus(_input: unknown, ctx: ExtensionBackendContext) {
  const available = await exists(bundledCli);

  if (!available) {
    return {
      available: false,
      cliPath: bundledCli,
      modelCacheRoot,
      message: 'Bundled llama-cli is missing. Add a Metal-enabled darwin-arm64 llama-cli under bin/darwin-arm64/.',
    };
  }

  await chmod(bundledCli, 0o755).catch(() => undefined);
  const version = await runProcess(ctx, bundledCli, ['--version']);

  return {
    available: version.exitCode === 0,
    cliPath: bundledCli,
    modelCacheRoot,
    version: version.stdout.trim() || version.stderr.trim(),
  };
}

export async function downloadModel(input: DownloadModelInput, _ctx: ExtensionBackendContext) {
  const repo = input.repo?.trim();
  const filename = input.filename?.trim();

  if (!repo) throw new Error('repo is required, for example unsloth/Qwen3.6-35B-A3B-MTP-GGUF.');
  if (!filename) throw new Error('filename is required, for example Q4_K_M.gguf.');
  if (filename.includes('/') || filename.includes('..')) throw new Error('filename must be a single GGUF filename, not a path.');

  const repoDir = join(modelCacheRoot, repo.replaceAll('/', '__'));
  const destination = join(repoDir, basename(filename));
  const partial = `${destination}.partial`;

  await mkdir(repoDir, { recursive: true });

  if (await exists(destination)) {
    const current = await stat(destination);
    return { modelPath: destination, bytes: current.size, cached: true };
  }

  await unlink(partial).catch(() => undefined);
  const url = `https://huggingface.co/${repo}/resolve/main/${encodeURIComponent(filename)}?download=true`;
  await download(url, partial);
  await rename(partial, destination);
  const current = await stat(destination);

  return { modelPath: destination, bytes: current.size, cached: false };
}

export async function runPrompt(input: RunPromptInput, _ctx: ExtensionBackendContext) {
  const modelPath = input.modelPath?.trim();
  const prompt = input.prompt?.trim();

  if (!modelPath) throw new Error('modelPath is required. Select or download a GGUF model first.');
  if (!prompt) throw new Error('prompt is required.');
  if (!(await exists(bundledCli))) throw new Error(`Bundled llama-cli is missing at ${bundledCli}`);
  if (!(await exists(modelPath))) throw new Error(`Model file does not exist: ${modelPath}`);

  await chmod(bundledCli, 0o755).catch(() => undefined);

  const args = [
    '-m',
    modelPath,
    '-p',
    prompt,
    '-ngl',
    String(input.gpuLayers ?? 999),
    '-c',
    String(input.contextSize ?? 8192),
  ];

  const result = await runProcess(ctx, bundledCli, args, { timeoutMs: 120_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `llama-cli exited with code ${result.exitCode}`);
  }

  return { output: result.stdout, stderr: result.stderr };
}
