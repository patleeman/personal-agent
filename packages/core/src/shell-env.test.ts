import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearResolvedChildProcessEnvCache, hydrateProcessEnvFromShell, resolveChildProcessEnv } from './shell-env.js';

const START = '__PERSONAL_AGENT_ENV_START__';
const END = '__PERSONAL_AGENT_ENV_END__';
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function renderEnvEntries(entries: string[] = []): string {
  return entries.map((entry) => `printf '%s\\0' ${JSON.stringify(entry)}`).join('\n');
}

function createFakeInteractiveShell(options: {
  prefix?: string;
  entries?: string[];
  entriesByArg?: Record<string, string[]>;
  exitCode?: number;
  counterFile?: string;
} = {}): string {
  const shellDir = createTempDir('shell-env-');
  const shellPath = join(shellDir, 'zsh');
  const defaultEntries = renderEnvEntries(options.entries ?? []);
  const entriesByArg = Object.entries(options.entriesByArg ?? {})
    .map(([arg, entries]) => `${JSON.stringify(arg)})\n${renderEnvEntries(entries)}\n;;`)
    .join('\n');
  const counterScript = options.counterFile
    ? `count=0\nif [ -f ${JSON.stringify(options.counterFile)} ]; then count=$(cat ${JSON.stringify(options.counterFile)}); fi\ncount=$((count + 1))\nprintf '%s' "$count" > ${JSON.stringify(options.counterFile)}\n`
    : '';

  const script = [
    '#!/bin/sh',
    counterScript.trim(),
    options.prefix ? `printf '%s' ${JSON.stringify(options.prefix)}` : '',
    `printf '%s\\0' ${JSON.stringify(START)}`,
    entriesByArg ? ['case "$1" in', entriesByArg, `*)\n${defaultEntries}\n;;`, 'esac'].join('\n') : defaultEntries,
    `printf '%s\\0' ${JSON.stringify(END)}`,
    `exit ${String(options.exitCode ?? 0)}`,
  ].filter(Boolean).join('\n');

  writeFileSync(shellPath, script, 'utf-8');
  chmodSync(shellPath, 0o755);
  return shellPath;
}

describe('resolveChildProcessEnv', () => {
  beforeEach(() => {
    clearResolvedChildProcessEnvCache();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('hydrates child env from the interactive shell and preserves base-only variables', () => {
    const shellPath = createFakeInteractiveShell({
      prefix: 'startup noise\n',
      entries: [
        'PATH=/opt/homebrew/bin:/usr/bin',
        'FROM_SHELL=1',
        'SHARED=from-shell',
      ],
    });

    const baseEnv = {
      SHELL: shellPath,
      HOME: '/tmp/patrick',
      PATH: '/usr/bin:/base/bin',
      BASE_ONLY: '1',
      SHARED: 'from-base',
    };

    const resolved = resolveChildProcessEnv({ OVERRIDE_ONLY: '1' }, baseEnv);

    expect(resolved).toMatchObject({
      BASE_ONLY: '1',
      FROM_SHELL: '1',
      OVERRIDE_ONLY: '1',
      SHARED: 'from-shell',
    });
    expect(resolved.PATH).toBe('/opt/homebrew/bin:/usr/bin:/base/bin');
  });

  it('uses the login + interactive zsh env so login PATH entries are available', () => {
    const shellPath = createFakeInteractiveShell({
      entriesByArg: {
        '-ic': [
          'PATH=/usr/bin',
          'FROM_RC=1',
        ],
        '-ilc': [
          'PATH=/opt/homebrew/bin:/usr/bin',
          'FROM_LOGIN=1',
          'FROM_RC=1',
        ],
      },
    });
    const baseEnv = {
      SHELL: shellPath,
      HOME: '/tmp/patrick',
      PATH: '/usr/bin:/base/bin',
    };

    const resolved = resolveChildProcessEnv({}, baseEnv);

    expect(resolved).toMatchObject({
      FROM_LOGIN: '1',
      FROM_RC: '1',
    });
    expect(resolved.PATH).toBe('/opt/homebrew/bin:/usr/bin:/base/bin');
  });

  it('merges PATH values even when the base env uses different key casing', () => {
    const shellPath = createFakeInteractiveShell({
      entries: ['PATH=/opt/homebrew/bin:/usr/bin'],
    });
    const baseEnv: NodeJS.ProcessEnv = {
      SHELL: shellPath,
      HOME: '/tmp/patrick',
      Path: '/usr/bin:/base/bin',
    };

    const resolved = resolveChildProcessEnv({}, baseEnv);

    expect(resolved.PATH).toBe('/opt/homebrew/bin:/usr/bin:/base/bin');
    expect('Path' in resolved).toBe(false);
  });

  it('hydrates a target env object in place using the resolved shell env', () => {
    const shellPath = createFakeInteractiveShell({
      entries: [
        'PATH=/opt/homebrew/bin:/usr/bin',
        'FROM_SHELL=1',
      ],
    });
    const targetEnv = {
      SHELL: shellPath,
      HOME: '/tmp/patrick',
      PATH: '/usr/bin:/base/bin',
      BASE_ONLY: '1',
    };

    const hydrated = hydrateProcessEnvFromShell(targetEnv);

    expect(hydrated).toBe(targetEnv);
    expect(targetEnv).toMatchObject({
      BASE_ONLY: '1',
      FROM_SHELL: '1',
      PATH: '/opt/homebrew/bin:/usr/bin:/base/bin',
    });
  });

  it('preserves the target PATH key casing when hydrating in place', () => {
    const shellPath = createFakeInteractiveShell({
      entries: ['PATH=/opt/homebrew/bin:/usr/bin'],
    });
    const targetEnv: NodeJS.ProcessEnv = {
      SHELL: shellPath,
      HOME: '/tmp/patrick',
      Path: '/usr/bin:/base/bin',
    };

    hydrateProcessEnvFromShell(targetEnv);

    expect(targetEnv.Path).toBe('/opt/homebrew/bin:/usr/bin:/base/bin');
    expect('PATH' in targetEnv).toBe(false);
  });

  it('falls back to the base env when shell capture fails', () => {
    const shellPath = createFakeInteractiveShell({ exitCode: 1 });
    const baseEnv = {
      SHELL: shellPath,
      HOME: '/tmp/patrick',
      PATH: '/usr/bin:/base/bin',
      BASE_ONLY: '1',
    };

    const resolved = resolveChildProcessEnv({ OVERRIDE_ONLY: '1' }, baseEnv);

    expect(resolved).toMatchObject({
      BASE_ONLY: '1',
      OVERRIDE_ONLY: '1',
      PATH: '/usr/bin:/base/bin',
    });
  });

  it('caches the captured shell env for the same shell identity', () => {
    const counterFile = join(createTempDir('shell-env-counter-'), 'count.txt');
    const shellPath = createFakeInteractiveShell({
      entries: ['PATH=/opt/homebrew/bin:/usr/bin'],
      counterFile,
    });

    const baseEnv = {
      SHELL: shellPath,
      HOME: '/tmp/patrick',
      USER: 'patrick',
      PATH: '/usr/bin:/base/bin',
    };

    resolveChildProcessEnv({}, baseEnv);
    resolveChildProcessEnv({ EXTRA: '1' }, { ...baseEnv, EXTRA_BASE: '1' });

    expect(readFileSync(counterFile, 'utf-8')).toBe('1');
  });
});
