import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { resolveNeutralChatCwd } from '@personal-agent/core';

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

export { resolveNeutralChatCwd };
