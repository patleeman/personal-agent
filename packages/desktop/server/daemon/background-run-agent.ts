import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BackgroundRunAgentSpec {
  prompt: string;
  /** @deprecated Ignored; background agents always use the shared runtime scope. */
  profile?: string;
  model?: string;
  noSession?: boolean;
  /** When set, only these tool names are exposed to the background agent. */
  allowedTools?: string[];
}

export function looksLikeBackgroundAgentRunnerEntryPath(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.replace(/\\/g, '/').toLowerCase();
  return normalized.endsWith('/daemon/background-agent-runner.js');
}

function resolveBackgroundAgentRunnerEntryPath(): string {
  const daemonModulePath = fileURLToPath(import.meta.url);
  const moduleDir = dirname(daemonModulePath);
  const repoRoot = process.env.PERSONAL_AGENT_REPO_ROOT;
  const candidates = [
    repoRoot ? resolve(repoRoot, 'packages/desktop/server/dist/daemon/background-agent-runner.js') : undefined,
    resolve(moduleDir, 'background-agent-runner.js'),
    resolve(moduleDir, '../server/daemon/background-agent-runner.js'),
    repoRoot ? resolve(repoRoot, 'packages/desktop/dist/server/daemon/background-agent-runner.js') : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

export function buildBackgroundAgentArgv(spec: BackgroundRunAgentSpec): string[] {
  const argv = [process.execPath, resolveBackgroundAgentRunnerEntryPath(), '--prompt', spec.prompt];

  if (spec.noSession === true) {
    argv.push('--no-session');
  }

  if (spec.model) {
    argv.push('--model', spec.model);
  }

  if (spec.allowedTools && spec.allowedTools.length > 0) {
    argv.push('--tools', spec.allowedTools.join(','));
  }

  return argv;
}
