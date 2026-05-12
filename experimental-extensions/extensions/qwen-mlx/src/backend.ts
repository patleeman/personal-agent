import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionBackendContext } from '@personal-agent/extensions';

const MODEL_ID = 'unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit';
const PROVIDER_ID = 'qwen-mlx';
const MODEL_PORT = 8011;
const BASE_URL = `http://127.0.0.1:${MODEL_PORT}/v1`;
const CACHE_DIR = join(homedir(), '.cache', 'personal-agent', 'qwen-mlx');
const VENV_DIR = join(CACHE_DIR, 'venv');
const VENV_PYTHON = join(VENV_DIR, 'bin', 'python');
const VENV_HF = join(VENV_DIR, 'bin', 'hf');
const VENV_MLX_SERVER = join(VENV_DIR, 'bin', 'mlx_lm.server');
const MODEL_CACHE_DIR = join(CACHE_DIR, 'hub', 'models--unsloth--Qwen3.6-35B-A3B-UD-MLX-4bit');
const LOG_KEY = 'logs/latest';
const ESTIMATED_MODEL_BYTES = 22 * 1024 * 1024 * 1024;

type JobState = {
  id: string;
  kind: 'setup';
  status: 'running' | 'succeeded' | 'failed';
  step: 'install' | 'download' | 'done';
  startedAt: string;
  finishedAt: string | null;
  message: string;
  progress: number;
  error: string | null;
};

let serverProcess: ChildProcessWithoutNullStreams | null = null;
let setupProcess: ChildProcessWithoutNullStreams | null = null;
let setupJob: JobState | null = null;
let lastLog = '';
let lastExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;

function appendLog(line: string) {
  lastLog = `${lastLog}${line}`.slice(-20000);
}

function updateSetupJob(update: Partial<JobState>) {
  if (!setupJob) return;
  setupJob = { ...setupJob, ...update };
}

function pickPythonCommand() {
  return existsSync('/opt/homebrew/bin/python3.10') ? '/opt/homebrew/bin/python3.10' : 'python3';
}

function spawnLogged(command: string, args: string[], ctx: ExtensionBackendContext, onClose: (code: number) => void) {
  const child = spawn(command, args, { env: { ...process.env, HF_HOME: CACHE_DIR }, stdio: ['ignore', 'pipe', 'pipe'] });
  const collect = (chunk: Buffer) => appendLog(chunk.toString('utf8'));
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('error', (error) => {
    appendLog(`${error.message}\n`);
    ctx.log.error('qwen mlx command failed', { command, message: error.message });
    onClose(1);
  });
  child.on('close', (code) => onClose(code ?? 1));
  return child;
}

function startInstall(ctx: ExtensionBackendContext) {
  updateSetupJob({ step: 'install', message: 'Installing mlx-lm and huggingface_hub into the extension venv…', progress: 15 });
  setupProcess = spawnLogged(VENV_PYTHON, ['-m', 'pip', 'install', '-U', 'pip', 'mlx-lm', 'huggingface_hub'], ctx, (code) => {
    setupProcess = null;
    if (code !== 0) {
      updateSetupJob({
        status: 'failed',
        message: 'Dependency install failed.',
        progress: 15,
        error: `install exited with code ${code}`,
        finishedAt: new Date().toISOString(),
      });
      void ctx.storage.put(LOG_KEY, lastLog).catch(() => undefined);
      return;
    }
    startDownload(ctx);
  });
}

function startDownload(ctx: ExtensionBackendContext) {
  updateSetupJob({ step: 'download', message: 'Downloading model from Hugging Face…', progress: 35 });
  setupProcess = spawnLogged(VENV_HF, ['download', MODEL_ID], ctx, (code) => {
    setupProcess = null;
    if (code === 0) {
      updateSetupJob({
        status: 'succeeded',
        step: 'done',
        message: 'Model downloaded.',
        progress: 100,
        finishedAt: new Date().toISOString(),
      });
    } else {
      updateSetupJob({
        status: 'failed',
        message: 'Model download failed.',
        progress: 35,
        error: `download exited with code ${code}`,
        finishedAt: new Date().toISOString(),
      });
    }
    void ctx.storage.put(LOG_KEY, lastLog).catch(() => undefined);
  });
}

function getDownloadedBytes(dir = MODEL_CACHE_DIR): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) total += getDownloadedBytes(path);
    else total += stat.size;
  }
  return total;
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function hasDownloadedModel() {
  const mainRef = join(MODEL_CACHE_DIR, 'refs', 'main');
  if (!existsSync(mainRef)) return false;
  try {
    const snapshot = readFileSync(mainRef, 'utf8').trim();
    return Boolean(snapshot) && existsSync(join(MODEL_CACHE_DIR, 'snapshots', snapshot));
  } catch {
    return false;
  }
}

async function readServerHealth() {
  try {
    const response = await fetch(`${BASE_URL}/models`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return { reachable: false, status: response.status, models: [] as string[] };
    const body = (await response.json()) as { data?: Array<{ id?: string }> };
    return { reachable: true, status: response.status, models: (body.data ?? []).map((model) => model.id ?? '').filter(Boolean) };
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error), models: [] as string[] };
  }
}

function getProcessState() {
  return {
    managedPid: serverProcess?.pid ?? null,
    managedRunning: Boolean(serverProcess && !serverProcess.killed && serverProcess.exitCode === null),
    setupPid: setupProcess?.pid ?? null,
    setupRunning: Boolean(setupProcess && !setupProcess.killed && setupProcess.exitCode === null),
    lastExit,
  };
}

export async function status(_input: unknown, _ctx: ExtensionBackendContext) {
  const health = await readServerHealth();
  const downloadedBytes = getDownloadedBytes();
  if (setupJob?.status === 'running' && setupJob.step === 'download') {
    const downloadProgress = Math.min(95, Math.max(35, Math.round((downloadedBytes / ESTIMATED_MODEL_BYTES) * 90)));
    setupJob = {
      ...setupJob,
      progress: downloadProgress,
      message: `Downloading model from Hugging Face… ${formatBytes(downloadedBytes)} downloaded`,
    };
  }
  return {
    ok: true,
    providerId: PROVIDER_ID,
    modelId: MODEL_ID,
    baseUrl: BASE_URL,
    cacheDir: CACHE_DIR,
    downloadedBytes,
    downloaded: formatBytes(downloadedBytes),
    installed: existsSync(VENV_PYTHON) && hasDownloadedModel(),
    setup: setupJob,
    server: health,
    process: getProcessState(),
    log: lastLog,
  };
}

export async function setup(_input: unknown, ctx: ExtensionBackendContext) {
  if (setupJob?.status === 'running') {
    return { ok: true, alreadyRunning: true, job: setupJob };
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  lastLog = '';
  setupJob = {
    id: `setup-${Date.now()}`,
    kind: 'setup',
    status: 'running',
    step: 'install',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    message: 'Installing mlx-lm and huggingface_hub…',
    progress: 5,
    error: null,
  };
  appendLog(`\n--- setup ${setupJob.startedAt} ---\n`);

  if (!existsSync(VENV_PYTHON)) {
    updateSetupJob({ message: 'Creating Python virtual environment…', progress: 5 });
    setupProcess = spawnLogged(pickPythonCommand(), ['-m', 'venv', VENV_DIR], ctx, (code) => {
      setupProcess = null;
      if (code !== 0) {
        updateSetupJob({
          status: 'failed',
          message: 'Virtualenv creation failed.',
          progress: 5,
          error: `venv exited with code ${code}`,
          finishedAt: new Date().toISOString(),
        });
        void ctx.storage.put(LOG_KEY, lastLog).catch(() => undefined);
        return;
      }
      startInstall(ctx);
    });
  } else {
    startInstall(ctx);
  }

  return { ok: true, started: true, job: setupJob };
}

export async function start(_input: unknown, ctx: ExtensionBackendContext) {
  const health = await readServerHealth();
  if (health.reachable) {
    return { ok: true, alreadyRunning: true, status: await status({}, ctx) };
  }
  if (serverProcess && serverProcess.exitCode === null) {
    return { ok: true, starting: true, status: await status({}, ctx) };
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  lastExit = null;
  appendLog(`\n--- start ${new Date().toISOString()} ---\n`);
  if (!existsSync(VENV_MLX_SERVER)) {
    appendLog('mlx_lm.server is not installed. Run setup/download first.\n');
    return { ok: false, error: 'mlx_lm.server is not installed. Run setup/download first.', status: await status({}, ctx) };
  }

  serverProcess = spawn(VENV_MLX_SERVER, ['--model', MODEL_ID, '--host', '127.0.0.1', '--port', String(MODEL_PORT)], {
    env: { ...process.env, HF_HOME: CACHE_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (chunk) => appendLog(chunk.toString('utf8')));
  serverProcess.stderr.on('data', (chunk) => appendLog(chunk.toString('utf8')));
  serverProcess.on('error', (error) => {
    appendLog(`server error: ${error.message}\n`);
    ctx.log.error('qwen mlx server failed', { message: error.message });
  });
  serverProcess.on('close', (code, signal) => {
    lastExit = { code, signal };
    appendLog(`server exited code=${String(code)} signal=${String(signal)}\n`);
    serverProcess = null;
  });

  return { ok: true, started: true, pid: serverProcess.pid, status: await status({}, ctx) };
}

export async function stop(_input: unknown, ctx: ExtensionBackendContext) {
  if (setupProcess && setupProcess.exitCode === null) {
    setupProcess.kill('SIGTERM');
    updateSetupJob({ status: 'failed', message: 'Setup cancelled.', error: 'cancelled', finishedAt: new Date().toISOString() });
    appendLog('cancelled setup\n');
  }
  if (!serverProcess || serverProcess.exitCode !== null) {
    return { ok: true, stopped: false, status: await status({}, ctx) };
  }
  const pid = serverProcess.pid;
  serverProcess.kill('SIGTERM');
  appendLog(`sent SIGTERM to pid=${String(pid)}\n`);
  return { ok: true, stopped: true, pid, status: await status({}, ctx) };
}
