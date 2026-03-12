import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';
import { getStateRoot } from '@personal-agent/core';

export const WEB_UI_SLOT_NAMES = ['blue', 'green'] as const;
export type WebUiSlotName = (typeof WEB_UI_SLOT_NAMES)[number];

const DEFAULT_WEB_UI_PORT = 3741;
const DEPLOY_STATE_VERSION = 1;

interface StoredWebUiReleaseRecord {
  sourceRepoRoot: string;
  builtAt: string;
  revision?: string;
}

interface StoredWebUiDeploymentState {
  version: 1;
  stablePort: number;
  activeSlot?: WebUiSlotName;
  slots: Partial<Record<WebUiSlotName, StoredWebUiReleaseRecord>>;
  updatedAt: string;
}

export interface WebUiReleaseSummary {
  slot: WebUiSlotName;
  slotDir: string;
  distDir: string;
  serverDir: string;
  serverEntryFile: string;
  sourceRepoRoot: string;
  builtAt: string;
  revision?: string;
}

export interface WebUiDeploymentSummary {
  stablePort: number;
  activeSlot?: WebUiSlotName;
  activeRelease?: WebUiReleaseSummary;
  inactiveRelease?: WebUiReleaseSummary;
}

export interface StageWebUiReleaseOptions {
  repoRoot: string;
  slot: WebUiSlotName;
  stablePort?: number;
}

export interface ActivateWebUiSlotOptions {
  slot: WebUiSlotName;
  stablePort?: number;
}

function normalizePort(value: number | undefined, fallback = DEFAULT_WEB_UI_PORT): number {
  if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > 65535) {
    return fallback;
  }

  return value as number;
}

function resolveWebUiStateDir(): string {
  return join(getStateRoot(), 'web');
}

function resolveWebUiSlotsDir(): string {
  return join(resolveWebUiStateDir(), 'slots');
}

function resolveWebUiDeployStateFile(): string {
  return join(resolveWebUiStateDir(), 'deploy-state.json');
}

function resolveWebUiSlotDir(slot: WebUiSlotName): string {
  return join(resolveWebUiSlotsDir(), slot);
}

function resolveWebUiSlotDistDir(slot: WebUiSlotName): string {
  return join(resolveWebUiSlotDir(slot), 'dist');
}

function resolveWebUiSlotServerDir(slot: WebUiSlotName): string {
  return join(resolveWebUiSlotDir(slot), 'dist-server');
}

function resolveWebUiSlotServerEntryFile(slot: WebUiSlotName): string {
  return join(resolveWebUiSlotServerDir(slot), 'index.js');
}

function resolveWebUiSlotNodeModulesLink(slot: WebUiSlotName): string {
  return join(resolveWebUiSlotDir(slot), 'node_modules');
}

function readDeployState(fallbackPort = DEFAULT_WEB_UI_PORT): StoredWebUiDeploymentState {
  const filePath = resolveWebUiDeployStateFile();
  if (!existsSync(filePath)) {
    return {
      version: DEPLOY_STATE_VERSION,
      stablePort: normalizePort(fallbackPort),
      slots: {},
      updatedAt: new Date(0).toISOString(),
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<StoredWebUiDeploymentState>;
    const activeSlot = parsed.activeSlot && WEB_UI_SLOT_NAMES.includes(parsed.activeSlot)
      ? parsed.activeSlot
      : undefined;
    const slots: Partial<Record<WebUiSlotName, StoredWebUiReleaseRecord>> = {};

    for (const slot of WEB_UI_SLOT_NAMES) {
      const record = parsed.slots?.[slot];
      if (!record || typeof record.sourceRepoRoot !== 'string' || typeof record.builtAt !== 'string') {
        continue;
      }

      slots[slot] = {
        sourceRepoRoot: resolve(record.sourceRepoRoot),
        builtAt: record.builtAt,
        revision: typeof record.revision === 'string' && record.revision.trim().length > 0
          ? record.revision.trim()
          : undefined,
      };
    }

    return {
      version: DEPLOY_STATE_VERSION,
      stablePort: normalizePort(parsed.stablePort, fallbackPort),
      activeSlot,
      slots,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return {
      version: DEPLOY_STATE_VERSION,
      stablePort: normalizePort(fallbackPort),
      slots: {},
      updatedAt: new Date(0).toISOString(),
    };
  }
}

function writeDeployState(state: StoredWebUiDeploymentState): void {
  const filePath = resolveWebUiDeployStateFile();
  mkdirSync(resolveWebUiStateDir(), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

function toReleaseSummary(slot: WebUiSlotName, record: StoredWebUiReleaseRecord | undefined): WebUiReleaseSummary | undefined {
  if (!record) {
    return undefined;
  }

  const serverEntryFile = resolveWebUiSlotServerEntryFile(slot);
  const distDir = resolveWebUiSlotDistDir(slot);
  if (!existsSync(serverEntryFile) || !existsSync(distDir)) {
    return undefined;
  }

  return {
    slot,
    slotDir: resolveWebUiSlotDir(slot),
    distDir,
    serverDir: resolveWebUiSlotServerDir(slot),
    serverEntryFile,
    sourceRepoRoot: record.sourceRepoRoot,
    builtAt: record.builtAt,
    revision: record.revision,
  };
}

function readRepoRevision(repoRoot: string): string | undefined {
  const result = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' });
  if (result.status !== 0) {
    return undefined;
  }

  const value = result.stdout.trim();
  return value.length > 0 ? value : undefined;
}

function resolveBuiltWebUiArtifacts(repoRoot: string): {
  sourceDistDir: string;
  sourceServerDir: string;
  nodeModulesDir: string;
} {
  const normalizedRepoRoot = resolve(repoRoot);
  const sourceDistDir = join(normalizedRepoRoot, 'packages', 'web', 'dist');
  const sourceServerDir = join(normalizedRepoRoot, 'packages', 'web', 'dist-server');
  const nodeModulesDir = join(normalizedRepoRoot, 'node_modules');

  if (!existsSync(sourceDistDir) || !existsSync(sourceServerDir)) {
    throw new Error(`Web UI build artifacts are missing in ${normalizedRepoRoot}. Run \`npm run build\` first.`);
  }

  if (!existsSync(nodeModulesDir)) {
    throw new Error(`node_modules is missing in ${normalizedRepoRoot}. Run \`npm install\` first.`);
  }

  return {
    sourceDistDir,
    sourceServerDir,
    nodeModulesDir,
  };
}

export function getInactiveWebUiSlot(activeSlot: WebUiSlotName | undefined): WebUiSlotName {
  return activeSlot === 'blue' ? 'green' : 'blue';
}

export function getWebUiSlotHealthPort(stablePort: number, slot: WebUiSlotName): number {
  const basePort = normalizePort(stablePort);
  const candidate = basePort + (slot === 'blue' ? 1 : 2);
  return candidate > 65535 ? basePort - (slot === 'blue' ? 1 : 2) : candidate;
}

export function getWebUiDeploymentSummary(options: { stablePort?: number } = {}): WebUiDeploymentSummary {
  const state = readDeployState(options.stablePort);
  const stablePort = normalizePort(options.stablePort, state.stablePort);
  const activeSlot = state.activeSlot;
  const activeRelease = activeSlot ? toReleaseSummary(activeSlot, state.slots[activeSlot]) : undefined;
  const inactiveSlot = getInactiveWebUiSlot(activeSlot);
  const inactiveRelease = toReleaseSummary(inactiveSlot, state.slots[inactiveSlot]);

  return {
    stablePort,
    activeSlot: activeRelease ? activeSlot : undefined,
    activeRelease,
    inactiveRelease,
  };
}

export function stageWebUiRelease(options: StageWebUiReleaseOptions): WebUiReleaseSummary {
  const normalizedRepoRoot = resolve(options.repoRoot);
  const { sourceDistDir, sourceServerDir, nodeModulesDir } = resolveBuiltWebUiArtifacts(normalizedRepoRoot);
  const slotDir = resolveWebUiSlotDir(options.slot);
  const distDir = resolveWebUiSlotDistDir(options.slot);
  const serverDir = resolveWebUiSlotServerDir(options.slot);
  const nodeModulesLink = resolveWebUiSlotNodeModulesLink(options.slot);
  const builtAt = new Date().toISOString();
  const revision = readRepoRevision(normalizedRepoRoot);

  rmSync(slotDir, { recursive: true, force: true });
  mkdirSync(slotDir, { recursive: true });
  cpSync(sourceDistDir, distDir, { recursive: true });
  cpSync(sourceServerDir, serverDir, { recursive: true });
  symlinkSync(nodeModulesDir, nodeModulesLink, 'dir');
  writeFileSync(join(slotDir, 'release.json'), `${JSON.stringify({
    slot: options.slot,
    sourceRepoRoot: normalizedRepoRoot,
    builtAt,
    revision,
  }, null, 2)}\n`);

  const state = readDeployState(options.stablePort);
  state.stablePort = normalizePort(options.stablePort, state.stablePort);
  state.slots[options.slot] = {
    sourceRepoRoot: normalizedRepoRoot,
    builtAt,
    revision,
  };
  state.updatedAt = builtAt;
  writeDeployState(state);

  return {
    slot: options.slot,
    slotDir,
    distDir,
    serverDir,
    serverEntryFile: resolveWebUiSlotServerEntryFile(options.slot),
    sourceRepoRoot: normalizedRepoRoot,
    builtAt,
    revision,
  };
}

export function activateWebUiSlot(options: ActivateWebUiSlotOptions): WebUiDeploymentSummary {
  const state = readDeployState(options.stablePort);
  const record = state.slots[options.slot];
  if (!record || !toReleaseSummary(options.slot, record)) {
    throw new Error(`Web UI slot ${options.slot} is not staged yet.`);
  }

  state.activeSlot = options.slot;
  state.stablePort = normalizePort(options.stablePort, state.stablePort);
  state.updatedAt = new Date().toISOString();
  writeDeployState(state);

  return getWebUiDeploymentSummary({ stablePort: state.stablePort });
}

export function ensureActiveWebUiRelease(options: { repoRoot: string; stablePort?: number }): WebUiReleaseSummary {
  const normalizedRepoRoot = resolve(options.repoRoot);
  const summary = getWebUiDeploymentSummary({ stablePort: options.stablePort });

  if (summary.activeRelease && summary.activeRelease.sourceRepoRoot === normalizedRepoRoot) {
    if (summary.stablePort !== normalizePort(options.stablePort, summary.stablePort)) {
      activateWebUiSlot({
        slot: summary.activeRelease.slot,
        stablePort: options.stablePort,
      });
    }
    return summary.activeRelease;
  }

  const slot = summary.activeSlot ?? 'blue';
  const release = stageWebUiRelease({
    repoRoot: normalizedRepoRoot,
    slot,
    stablePort: options.stablePort,
  });
  activateWebUiSlot({ slot, stablePort: options.stablePort });
  return release;
}
