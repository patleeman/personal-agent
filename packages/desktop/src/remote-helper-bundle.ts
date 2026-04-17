import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { app } from 'electron';
import { resolveDesktopRuntimePaths } from './desktop-env.js';
import type { RemotePlatformInfo } from './remote-platform.js';

export interface RemoteHelperBinaryState {
  version: string;
  path: string;
}

function resolveVendorRoot(): string {
  const runtime = resolveDesktopRuntimePaths();
  if (app.isPackaged && process.env.PERSONAL_AGENT_DESKTOP_DEV_BUNDLE !== '1') {
    return resolve(runtime.repoRoot, 'vendor', 'remote-helper');
  }

  return resolve(runtime.repoRoot, 'packages', 'desktop', 'vendor', 'remote-helper');
}

export function resolveRemoteHelperBinary(platform: RemotePlatformInfo): RemoteHelperBinaryState {
  const platformDir = resolve(resolveVendorRoot(), platform.key);
  const binaryPath = resolve(platformDir, 'pa-ssh-remote-helper');
  const versionPath = resolve(platformDir, 'VERSION');

  if (!existsSync(binaryPath)) {
    throw new Error(`Remote helper binary missing for ${platform.key}. Rebuild the desktop app dependencies.`);
  }
  if (!existsSync(versionPath)) {
    throw new Error(`Remote helper version metadata missing for ${platform.key}. Rebuild the desktop app dependencies.`);
  }

  return {
    version: readFileSync(versionPath, 'utf-8').trim() || 'unknown',
    path: binaryPath,
  };
}
