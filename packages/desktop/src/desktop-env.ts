import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStateRoot } from '@personal-agent/core';

export interface DesktopRuntimePaths {
  repoRoot: string;
  nodeCommand: string;
  daemonEntryFile: string;
  webServerEntryFile: string;
  webDistDir: string;
  desktopStateDir: string;
  desktopLogsDir: string;
  desktopConfigFile: string;
  trayTemplateIconFile: string;
  colorIconFile: string;
}

function resolveRepoRoot(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.PERSONAL_AGENT_REPO_ROOT,
    resolve(currentDir, '..', '..', '..'),
    resolve(process.cwd()),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  for (const candidate of candidates) {
    const packageJsonPath = resolve(candidate, 'package.json');
    const packagesDir = resolve(candidate, 'packages');
    if (existsSync(packageJsonPath) && existsSync(packagesDir)) {
      return candidate;
    }
  }

  throw new Error('Could not resolve personal-agent repo root for the desktop app.');
}

function resolveExistingFile(label: string, candidates: string[]): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not resolve ${label}. Build the required package artifacts first.`);
}

export function resolveDesktopRuntimePaths(): DesktopRuntimePaths {
  const repoRoot = resolveRepoRoot();
  const stateRoot = getStateRoot();
  const desktopStateDir = resolve(stateRoot, 'desktop');
  const desktopLogsDir = resolve(desktopStateDir, 'logs');
  const desktopConfigFile = resolve(desktopStateDir, 'config.json');

  mkdirSync(desktopLogsDir, { recursive: true, mode: 0o700 });

  const nodeCommand = process.env.PERSONAL_AGENT_NODE_PATH?.trim() || 'node';

  const daemonEntryFile = resolveExistingFile('daemon entry file', [
    resolve(repoRoot, 'packages', 'daemon', 'dist', 'index.js'),
  ]);
  const webServerEntryFile = resolveExistingFile('web server entry file', [
    resolve(repoRoot, 'packages', 'web', 'dist-server', 'index.js'),
  ]);
  const webDistDir = resolveExistingFile('web UI dist directory', [
    resolve(repoRoot, 'packages', 'web', 'dist'),
  ]);
  const trayTemplateIconFile = resolveExistingFile('desktop tray icon', [
    resolve(repoRoot, 'packages', 'desktop', 'assets', 'icon-template.svg'),
  ]);
  const colorIconFile = resolveExistingFile('desktop color icon', [
    resolve(repoRoot, 'packages', 'desktop', 'assets', 'icon-color.svg'),
  ]);

  return {
    repoRoot,
    nodeCommand,
    daemonEntryFile,
    webServerEntryFile,
    webDistDir,
    desktopStateDir,
    desktopLogsDir,
    desktopConfigFile,
    trayTemplateIconFile,
    colorIconFile,
  };
}
