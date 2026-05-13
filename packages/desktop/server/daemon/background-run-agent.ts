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

export function looksLikePersonalAgentCliEntryPath(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.replace(/\\/g, '/').toLowerCase();
  return normalized.endsWith('/cli/dist/index.js') || normalized.endsWith('/packages/cli/dist/index.js');
}

function resolveBackgroundAgentCliEntryPath(): string | undefined {
  const daemonModulePath = fileURLToPath(import.meta.url);
  const daemonDir = dirname(daemonModulePath);
  const candidates = [
    resolve(daemonDir, '../../../cli/dist/index.js'),
    resolve(daemonDir, '../../../../../packages/cli/dist/index.js'),
    resolve(process.cwd(), 'packages/cli/dist/index.js'),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

export function buildBackgroundAgentArgv(spec: BackgroundRunAgentSpec): string[] {
  const cliEntryPath = resolveBackgroundAgentCliEntryPath();
  const argv = cliEntryPath ? [process.execPath, cliEntryPath, '--plain', 'tui'] : ['pa', '--plain', 'tui'];

  argv.push('--');

  if (spec.noSession === true) {
    argv.push('--no-session');
  }

  if (spec.model) {
    argv.push('--model', spec.model);
  }

  if (spec.allowedTools && spec.allowedTools.length > 0) {
    argv.push('--tools', spec.allowedTools.join(','));
  }

  argv.push('-p', spec.prompt);
  return argv;
}
