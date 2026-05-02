import { copyFile, mkdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { RuntimeStatePaths } from './paths.js';

export interface PreparePiAgentDirOptions {
  statePaths: RuntimeStatePaths;
  legacyAgentDir?: string;
  copyLegacyAuth?: boolean;
}

export interface PreparePiAgentDirResult {
  agentDir: string;
  authFile: string;
  sessionsDir: string;
  copiedLegacyAuth: boolean;
}

export async function preparePiAgentDir(
  options: PreparePiAgentDirOptions,
): Promise<PreparePiAgentDirResult> {
  const legacyAgentDir = options.legacyAgentDir ?? join(homedir(), '.pi', 'agent');
  const copyLegacyAuth = options.copyLegacyAuth ?? true;

  const agentDir = join(options.statePaths.root, 'pi-agent');
  const authFile = join(agentDir, 'auth.json');
  const sessionsDir = join(agentDir, 'sessions');

  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  await mkdir(sessionsDir, { recursive: true, mode: 0o700 });

  let copiedLegacyAuth = false;

  if (copyLegacyAuth) {
    const legacyAuthFile = join(legacyAgentDir, 'auth.json');
    if (!existsSync(authFile) && existsSync(legacyAuthFile)) {
      await copyFile(legacyAuthFile, authFile);
      copiedLegacyAuth = true;
    }
  }

  // Sanity check that agentDir is writable.
  await stat(agentDir);

  return {
    agentDir,
    authFile,
    sessionsDir,
    copiedLegacyAuth,
  };
}
