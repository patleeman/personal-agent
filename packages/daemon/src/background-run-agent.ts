import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BackgroundRunAgentSpec {
  prompt: string;
  profile?: string;
  model?: string;
  noSession?: boolean;
}

export function looksLikePersonalAgentCliEntryPath(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.replace(/\\/g, '/').toLowerCase();
  return normalized.endsWith('/cli/dist/index.js') || normalized.endsWith('/packages/cli/dist/index.js');
}

function resolveBackgroundAgentCliEntryPath(): string | undefined {
  const daemonModulePath = fileURLToPath(import.meta.url);
  const candidate = resolve(dirname(daemonModulePath), '../../cli/dist/index.js');
  return existsSync(candidate) ? candidate : undefined;
}

export function buildBackgroundAgentArgv(spec: BackgroundRunAgentSpec): string[] {
  const cliEntryPath = resolveBackgroundAgentCliEntryPath();
  const argv = cliEntryPath
    ? [process.execPath, cliEntryPath, '--plain', 'tui']
    : ['pa', '--plain', 'tui'];

  if (spec.profile) {
    argv.push('--profile', spec.profile);
  }

  argv.push('--');

  if (spec.noSession === true) {
    argv.push('--no-session');
  }

  if (spec.model) {
    argv.push('--model', spec.model);
  }

  argv.push('-p', spec.prompt);
  return argv;
}
