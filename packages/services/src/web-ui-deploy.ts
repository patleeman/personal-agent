import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

const DEFAULT_WEB_UI_PORT = 3741;

export interface WebUiReleaseSummary {
  distDir: string;
  serverDir: string;
  serverEntryFile: string;
  sourceRepoRoot: string;
  revision?: string;
}

export interface WebUiDeploymentSummary {
  stablePort: number;
  activeRelease?: WebUiReleaseSummary;
}

function normalizePort(value: number | undefined, fallback = DEFAULT_WEB_UI_PORT): number {
  if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > 65535) {
    return fallback;
  }

  return value as number;
}

function readRepoRevision(repoRoot: string): string | undefined {
  const result = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' });
  if (result.status !== 0) {
    return undefined;
  }

  const value = result.stdout.trim();
  return value.length > 0 ? value : undefined;
}

function resolveBuiltWebUiArtifacts(repoRoot: string): WebUiReleaseSummary {
  const sourceRepoRoot = resolve(repoRoot);
  const distDir = join(sourceRepoRoot, 'packages', 'web', 'dist');
  const serverDir = join(sourceRepoRoot, 'packages', 'web', 'dist-server');
  const serverEntryFile = join(serverDir, 'index.js');
  const nodeModulesDir = join(sourceRepoRoot, 'node_modules');

  if (!existsSync(distDir) || !existsSync(serverDir) || !existsSync(serverEntryFile)) {
    throw new Error(`Web UI build artifacts are missing in ${sourceRepoRoot}. Run \`npm run build\` first.`);
  }

  if (!existsSync(nodeModulesDir)) {
    throw new Error(`node_modules is missing in ${sourceRepoRoot}. Run \`npm install\` first.`);
  }

  return {
    distDir,
    serverDir,
    serverEntryFile,
    sourceRepoRoot,
    revision: readRepoRevision(sourceRepoRoot),
  };
}

export function getWebUiDeploymentSummary(options: { repoRoot: string; stablePort?: number }): WebUiDeploymentSummary {
  let activeRelease: WebUiReleaseSummary | undefined;

  try {
    activeRelease = resolveBuiltWebUiArtifacts(options.repoRoot);
  } catch {
    activeRelease = undefined;
  }

  return {
    stablePort: normalizePort(options.stablePort),
    activeRelease,
  };
}

export function ensureActiveWebUiRelease(options: { repoRoot: string; stablePort?: number }): WebUiReleaseSummary {
  return resolveBuiltWebUiArtifacts(options.repoRoot);
}
