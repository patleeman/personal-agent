import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionBackendContext } from '@personal-agent/extensions';

const DEFAULT_MODEL_ID = 'unsloth/Qwen3.6-35B-A3B-UD-MLX-4bit';
const PROVIDER_ID = 'mlx-local';
const MODEL_PORT = 8011;
const BASE_URL = `http://127.0.0.1:${MODEL_PORT}/v1`;
const CACHE_DIR = join(homedir(), '.cache', 'personal-agent', 'mlx-local-models');
const VENV_DIR = join(CACHE_DIR, 'venv');
const VENV_PYTHON = join(VENV_DIR, 'bin', 'python');
const VENV_HF = join(VENV_DIR, 'bin', 'hf');
const VENV_MLX_SERVER = join(VENV_DIR, 'bin', 'mlx_lm.server');
const LOG_FILE = join(CACHE_DIR, 'latest.log');
const MODEL_KEY = 'settings/modelId';
const SERVER_PID_KEY = 'process/serverPid';
const SETUP_PID_KEY = 'process/setupPid';
const SETUP_MODEL_KEY = 'process/setupModel';
const ESTIMATED_MODEL_BYTES = 22 * 1024 * 1024 * 1024;

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function modelCacheDir(modelId: string) {
  return join(CACHE_DIR, 'hub', `models--${modelId.replaceAll('/', '--')}`);
}

function pickPythonCommand() {
  return existsSync('/opt/homebrew/bin/python3.10') ? '/opt/homebrew/bin/python3.10' : 'python3';
}

async function getSelectedModelId(ctx: ExtensionBackendContext) {
  const stored = await ctx.storage.get(MODEL_KEY).catch(() => null);
  return typeof stored === 'string' && stored.trim() ? stored.trim() : DEFAULT_MODEL_ID;
}

async function setSelectedModelId(ctx: ExtensionBackendContext, modelId: string) {
  const normalized = modelId.trim();
  if (!normalized) throw new Error('Model id is required.');
  await ctx.storage.put(MODEL_KEY, normalized);
  return normalized;
}

function readLog() {
  if (!existsSync(LOG_FILE)) return '';
  return readFileSync(LOG_FILE, 'utf8').slice(-30000);
}

async function appendLog(ctx: ExtensionBackendContext, line: string) {
  mkdirSync(CACHE_DIR, { recursive: true });
  await ctx.shell.exec({ command: 'sh', args: ['-c', `printf %s ${shellQuote(line)} >> ${shellQuote(LOG_FILE)}`] });
}

async function isPidRunning(ctx: ExtensionBackendContext, pid: number | null) {
  if (!pid) return false;
  const result = await ctx.shell.exec({ command: 'sh', args: ['-c', `kill -0 ${pid} >/dev/null 2>&1 && echo yes || true`] });
  return result.stdout.trim() === 'yes';
}

function getDownloadedBytes(dir: string): number {
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

function hasDownloadedModel(modelId: string) {
  const mainRef = join(modelCacheDir(modelId), 'refs', 'main');
  if (!existsSync(mainRef)) return false;
  try {
    const snapshot = readFileSync(mainRef, 'utf8').trim();
    return Boolean(snapshot) && existsSync(join(modelCacheDir(modelId), 'snapshots', snapshot));
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

async function readPid(ctx: ExtensionBackendContext, key: string) {
  const stored = await ctx.storage.get(key).catch(() => null);
  const pid = typeof stored === 'number' ? stored : Number(stored);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

export async function status(_input: unknown, ctx: ExtensionBackendContext) {
  const selectedModelId = await getSelectedModelId(ctx);
  const setupModel = (await ctx.storage.get<string>(SETUP_MODEL_KEY).catch(() => null)) || selectedModelId;
  const serverPid = await readPid(ctx, SERVER_PID_KEY);
  const setupPid = await readPid(ctx, SETUP_PID_KEY);
  const [serverRunning, setupRunning, health] = await Promise.all([
    isPidRunning(ctx, serverPid),
    isPidRunning(ctx, setupPid),
    readServerHealth(),
  ]);
  const downloadedBytes = getDownloadedBytes(modelCacheDir(setupRunning ? setupModel : selectedModelId));
  const installed = existsSync(VENV_PYTHON) && hasDownloadedModel(selectedModelId);
  const setupProgress = setupRunning
    ? Math.min(95, Math.max(15, Math.round((downloadedBytes / ESTIMATED_MODEL_BYTES) * 90)))
    : installed
      ? 100
      : 0;
  return {
    ok: true,
    providerId: PROVIDER_ID,
    selectedModelId,
    loadedModelId: health.models[0] ?? (serverRunning ? selectedModelId : null),
    baseUrl: BASE_URL,
    cacheDir: CACHE_DIR,
    downloadedBytes,
    downloaded: formatBytes(downloadedBytes),
    installed,
    setup: setupRunning
      ? {
          status: 'running',
          message: `Downloading ${setupModel}… ${formatBytes(downloadedBytes)} downloaded`,
          progress: setupProgress,
          error: null,
        }
      : null,
    server: health,
    process: { managedPid: serverPid, managedRunning: serverRunning, setupPid, setupRunning, lastExit: null },
    log: readLog(),
  };
}

export async function setModel(input: unknown, ctx: ExtensionBackendContext) {
  const modelId = typeof input === 'object' && input && 'modelId' in input ? String((input as { modelId: unknown }).modelId) : '';
  const serverRunning = await isPidRunning(ctx, await readPid(ctx, SERVER_PID_KEY));
  if (serverRunning) throw new Error('Stop the current model before changing models.');
  const selectedModelId = await setSelectedModelId(ctx, modelId);
  await appendLog(ctx, `selected model ${selectedModelId}\n`);
  return { ok: true, status: await status({}, ctx) };
}

export async function setup(input: unknown, ctx: ExtensionBackendContext) {
  const setupRunning = await isPidRunning(ctx, await readPid(ctx, SETUP_PID_KEY));
  if (setupRunning) return { ok: true, alreadyRunning: true, status: await status({}, ctx) };
  const requestedModelId =
    typeof input === 'object' && input && 'modelId' in input ? String((input as { modelId?: unknown }).modelId ?? '') : '';
  const modelId = requestedModelId.trim() ? await setSelectedModelId(ctx, requestedModelId) : await getSelectedModelId(ctx);
  mkdirSync(CACHE_DIR, { recursive: true });
  await ctx.storage.put(SETUP_MODEL_KEY, modelId);
  const script = [
    `: > ${shellQuote(LOG_FILE)}`,
    `echo ${shellQuote(`--- setup ${new Date().toISOString()} ${modelId} ---`)} >> ${shellQuote(LOG_FILE)}`,
    `[ -x ${shellQuote(VENV_PYTHON)} ] || ${shellQuote(pickPythonCommand())} -m venv ${shellQuote(VENV_DIR)} >> ${shellQuote(LOG_FILE)} 2>&1`,
    `${shellQuote(VENV_PYTHON)} -m pip install -U pip mlx-lm huggingface_hub >> ${shellQuote(LOG_FILE)} 2>&1`,
    `HF_HOME=${shellQuote(CACHE_DIR)} ${shellQuote(VENV_HF)} download ${shellQuote(modelId)} >> ${shellQuote(LOG_FILE)} 2>&1`,
    `echo ${shellQuote('--- setup complete ---')} >> ${shellQuote(LOG_FILE)}`,
  ].join(' && ');
  const result = await ctx.shell.exec({ command: 'sh', args: ['-c', `nohup sh -c ${shellQuote(script)} >/dev/null 2>&1 & echo $!`] });
  await ctx.storage.put(SETUP_PID_KEY, Number(result.stdout.trim()));
  return { ok: true, started: true, status: await status({}, ctx) };
}

export async function start(_input: unknown, ctx: ExtensionBackendContext) {
  const modelId = await getSelectedModelId(ctx);
  const health = await readServerHealth();
  if (health.reachable) return { ok: true, alreadyRunning: true, status: await status({}, ctx) };
  const serverRunning = await isPidRunning(ctx, await readPid(ctx, SERVER_PID_KEY));
  if (serverRunning) return { ok: true, starting: true, status: await status({}, ctx) };
  if (!existsSync(VENV_MLX_SERVER)) {
    await appendLog(ctx, 'mlx_lm.server is not installed. Run setup/download first.\n');
    return { ok: false, error: 'mlx_lm.server is not installed. Run setup/download first.', status: await status({}, ctx) };
  }
  await appendLog(ctx, `\n--- start ${new Date().toISOString()} ${modelId} ---\n`);
  const command = `HF_HOME=${shellQuote(CACHE_DIR)} ${shellQuote(VENV_MLX_SERVER)} --model ${shellQuote(modelId)} --host 127.0.0.1 --port ${MODEL_PORT} >> ${shellQuote(LOG_FILE)} 2>&1`;
  const result = await ctx.shell.exec({ command: 'sh', args: ['-c', `nohup sh -c ${shellQuote(command)} >/dev/null 2>&1 & echo $!`] });
  await ctx.storage.put(SERVER_PID_KEY, Number(result.stdout.trim()));
  return { ok: true, started: true, pid: Number(result.stdout.trim()), status: await status({}, ctx) };
}

export async function stop(_input: unknown, ctx: ExtensionBackendContext) {
  const setupPid = await readPid(ctx, SETUP_PID_KEY);
  const serverPid = await readPid(ctx, SERVER_PID_KEY);
  if (await isPidRunning(ctx, setupPid)) {
    await ctx.shell.exec({ command: 'sh', args: ['-c', `kill ${setupPid} >/dev/null 2>&1 || true`] });
    await appendLog(ctx, 'cancelled setup\n');
  }
  if (!(await isPidRunning(ctx, serverPid))) return { ok: true, stopped: false, status: await status({}, ctx) };
  await ctx.shell.exec({ command: 'sh', args: ['-c', `kill ${serverPid} >/dev/null 2>&1 || true`] });
  await appendLog(ctx, `sent SIGTERM to pid=${String(serverPid)}\n`);
  return { ok: true, stopped: true, pid: serverPid, status: await status({}, ctx) };
}

export async function searchModels(input: unknown, _ctx: ExtensionBackendContext) {
  const query = typeof input === 'object' && input && 'query' in input ? String((input as { query: unknown }).query).trim() : '';
  if (!query) return { ok: true, models: [] };
  const params = new URLSearchParams({ search: `${query} mlx`, filter: 'mlx', limit: '10', sort: 'downloads', direction: '-1' });
  const response = await fetch(`https://huggingface.co/api/models?${params.toString()}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Hugging Face search failed: ${response.status}`);
  const body = (await response.json()) as Array<{ id?: string; modelId?: string; downloads?: number; likes?: number; tags?: string[] }>;
  return {
    ok: true,
    models: body
      .map((model) => ({
        id: model.id ?? model.modelId ?? '',
        downloads: model.downloads ?? 0,
        likes: model.likes ?? 0,
        tags: model.tags ?? [],
      }))
      .filter((model) => model.id),
  };
}
