import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { listResolvedProjectRepoRoots } from '@personal-agent/core';
function expandHome(pathValue) {
    if (pathValue === '~') {
        return homedir();
    }
    if (pathValue.startsWith('~/')) {
        return resolve(homedir(), pathValue.slice(2));
    }
    return pathValue;
}
export function resolveRequestedCwd(cwd, baseDir = process.cwd()) {
    const trimmed = cwd?.trim();
    if (!trimmed) {
        return undefined;
    }
    return resolve(baseDir, expandHome(trimmed));
}
export function resolveConversationCwd(input) {
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
        ? referencedProjectRepoRoots[0]
        : normalizedDefaultCwd;
}
