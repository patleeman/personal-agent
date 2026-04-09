import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectCliBinary } from './cli-binary.js';

function createTempScript(name: string, contents: string): { cwd: string; scriptPath: string } {
  const cwd = join(tmpdir(), `pa-cli-bin-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(cwd, { recursive: true });
  const scriptPath = join(cwd, name);
  writeFileSync(scriptPath, contents);
  chmodSync(scriptPath, 0o755);
  return { cwd, scriptPath };
}

describe('cli binary inspection', () => {
  const originalPath = process.env.PATH;

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  it('reports an installed binary when an executable path is provided', () => {
    const { cwd, scriptPath } = createTempScript('fake-cli', '#!/bin/sh\necho "fake-cli 1.2.3"\n');

    const result = inspectCliBinary({ command: scriptPath, cwd });
    expect(result).toEqual({
      available: true,
      command: scriptPath,
      path: scriptPath,
      version: 'fake-cli 1.2.3',
    });
  });

  it('reports an empty command before attempting to spawn', () => {
    expect(inspectCliBinary({ command: '   ' })).toEqual({
      available: false,
      command: '',
      error: 'Command is empty',
    });
  });

  it('resolves a binary discovered on PATH', () => {
    const { cwd, scriptPath } = createTempScript(
      'fake-path-cli',
      '#!/bin/sh\nif [ "$1" = "--custom-version" ]; then\n  echo "fake-path-cli 2.0.0"\n  exit 0\nfi\nexit 9\n',
    );

    process.env.PATH = `${cwd}${delimiter}${originalPath ?? ''}`;

    const result = inspectCliBinary({
      command: 'fake-path-cli',
      cwd,
      versionArgs: ['--custom-version'],
    });

    expect(result).toEqual({
      available: true,
      command: 'fake-path-cli',
      path: scriptPath,
      version: 'fake-path-cli 2.0.0',
    });
  });

  it('surfaces stderr when the version command exits non-zero', () => {
    const { cwd, scriptPath } = createTempScript(
      'broken-cli',
      '#!/bin/sh\necho "broken version" 1>&2\nexit 2\n',
    );

    const result = inspectCliBinary({ command: scriptPath, cwd });
    expect(result).toEqual({
      available: false,
      command: scriptPath,
      error: 'broken version',
    });
  });

  it('reports a missing binary as unavailable', () => {
    const result = inspectCliBinary({ command: `missing-cli-${Date.now()}` });
    expect(result.available).toBe(false);
    expect(result.command).toContain('missing-cli-');
    expect(result.error).toBeTruthy();
  });
});
