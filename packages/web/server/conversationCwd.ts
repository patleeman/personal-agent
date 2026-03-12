import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { listResolvedProjectRepoRoots } from '@personal-agent/core';

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
  referencedProjectIds?: string[];
}): string {
  const normalizedDefaultCwd = resolveRequestedCwd(input.defaultCwd, process.cwd()) ?? process.cwd();
  const explicitCwd = resolveRequestedCwd(input.explicitCwd, normalizedDefaultCwd);

  if (explicitCwd) {
    return explicitCwd;
  }

  const referencedProjectRepoRoots = listResolvedProjectRepoRoots({
    repoRoot: input.repoRoot,
    profile: input.profile,
    projectIds: input.referencedProjectIds ?? [],
  });

  return referencedProjectRepoRoots.length === 1
    ? referencedProjectRepoRoots[0] as string
    : normalizedDefaultCwd;
}
