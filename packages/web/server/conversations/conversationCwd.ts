import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getPiAgentRuntimeDir } from '@personal-agent/core';

function expandHome(pathValue: string): string {
  if (pathValue === '~') {
    return homedir();
  }

  if (pathValue.startsWith('~/')) {
    return resolve(homedir(), pathValue.slice(2));
  }

  return pathValue;
}

export function resolveRequestedCwd(cwd: string | null | undefined, baseDir: string = process.cwd()): string | undefined {
  const trimmed = cwd?.trim();
  if (!trimmed) {
    return undefined;
  }

  return resolve(baseDir, expandHome(trimmed));
}

export function resolveConversationCwd(input: {
  repoRoot: string;
  profile: string;
  explicitCwd?: string | null;
  defaultCwd?: string;
}): string {
  const normalizedDefaultCwd = resolveRequestedCwd(input.defaultCwd, process.cwd()) ?? process.cwd();
  const explicitCwd = resolveRequestedCwd(input.explicitCwd, normalizedDefaultCwd);

  return explicitCwd ?? normalizedDefaultCwd;
}

export function resolveNeutralChatCwd(profile: string): string {
  const safeProfile = profile.trim().replace(/[^a-zA-Z0-9._-]+/g, '-') || 'default';
  const cwd = join(getPiAgentRuntimeDir(), 'chat-workspaces', safeProfile);
  mkdirSync(cwd, { recursive: true });
  return cwd;
}
