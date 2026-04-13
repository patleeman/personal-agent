import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import { getStateRoot } from '@personal-agent/core';

export interface DesktopRuntimePaths {
  repoRoot: string;
  nodeCommand: string;
  useElectronRunAsNode: boolean;
  daemonEntryFile: string;
  webDistDir: string;
  desktopStateDir: string;
  desktopLogsDir: string;
  desktopConfigFile: string;
  trayTemplateIconFile: string;
  colorIconFile: string;
}

interface DesktopRuntimePathContext {
  currentDir?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  isPackaged?: boolean;
  appRoot?: string;
  resourcesPath?: string;
}

function resolveDevRepoRoot(context: DesktopRuntimePathContext): string {
  const currentDir = context.currentDir ?? dirname(fileURLToPath(import.meta.url));
  const env = context.env ?? process.env;
  const cwd = context.cwd ?? process.cwd();
  const candidates = [
    env.PERSONAL_AGENT_REPO_ROOT,
    resolve(currentDir, '..', '..', '..'),
    resolve(cwd),
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

function resolveAppRoot(context: DesktopRuntimePathContext): string {
  const appRoot = context.appRoot?.trim();
  if (appRoot) {
    return resolve(appRoot);
  }

  throw new Error('Could not resolve the packaged desktop app root.');
}

function resolvePackagedRepoRoot(context: DesktopRuntimePathContext): string {
  const resourcesPath = context.resourcesPath?.trim();
  if (resourcesPath) {
    return resolve(resourcesPath);
  }

  throw new Error('Could not resolve the packaged desktop resources directory.');
}

export function resolveDesktopRuntimePathsForContext(context: DesktopRuntimePathContext = {}): DesktopRuntimePaths {
  const env = context.env ?? process.env;
  const execPath = context.execPath ?? process.execPath;
  const isPackaged = context.isPackaged ?? false;
  const repoRoot = isPackaged ? resolvePackagedRepoRoot(context) : resolveDevRepoRoot(context);
  const appRoot = isPackaged ? resolveAppRoot(context) : repoRoot;
  const stateRoot = getStateRoot();
  const desktopStateDir = resolve(stateRoot, 'desktop');
  const desktopLogsDir = resolve(desktopStateDir, 'logs');
  const desktopConfigFile = resolve(desktopStateDir, 'config.json');

  mkdirSync(desktopLogsDir, { recursive: true, mode: 0o700 });

  const nodeCommand = isPackaged
    ? execPath
    : env.PERSONAL_AGENT_NODE_PATH?.trim() || 'node';

  const daemonEntryFile = resolveExistingFile('daemon entry file', isPackaged
    ? [resolve(appRoot, 'node_modules', '@personal-agent', 'daemon', 'dist', 'index.js')]
    : [resolve(repoRoot, 'packages', 'daemon', 'dist', 'index.js')]);
  const webDistDir = resolveExistingFile('web UI dist directory', isPackaged
    ? [resolve(appRoot, 'node_modules', '@personal-agent', 'web', 'dist')]
    : [resolve(repoRoot, 'packages', 'web', 'dist')]);
  const trayTemplateIconFile = resolveExistingFile('desktop tray icon', isPackaged
    ? [resolve(appRoot, 'assets', 'iconTemplate.png')]
    : [resolve(repoRoot, 'packages', 'desktop', 'assets', 'iconTemplate.png')]);
  const colorIconFile = resolveExistingFile('desktop color icon', isPackaged
    ? [resolve(appRoot, 'assets', 'icon.png')]
    : [resolve(repoRoot, 'packages', 'desktop', 'assets', 'icon.png')]);

  return {
    repoRoot,
    nodeCommand,
    useElectronRunAsNode: isPackaged,
    daemonEntryFile,
    webDistDir,
    desktopStateDir,
    desktopLogsDir,
    desktopConfigFile,
    trayTemplateIconFile,
    colorIconFile,
  };
}

export function resolveDesktopRuntimePaths(): DesktopRuntimePaths {
  const forceDevBundle = process.env.PERSONAL_AGENT_DESKTOP_DEV_BUNDLE === '1';

  return resolveDesktopRuntimePathsForContext({
    currentDir: dirname(fileURLToPath(import.meta.url)),
    cwd: process.cwd(),
    env: process.env,
    execPath: process.execPath,
    isPackaged: forceDevBundle ? false : app.isPackaged,
    appRoot: forceDevBundle
      ? undefined
      : (() => {
          try {
            return app.getAppPath();
          } catch {
            return undefined;
          }
        })(),
    resourcesPath: forceDevBundle ? undefined : process.resourcesPath,
  });
}
