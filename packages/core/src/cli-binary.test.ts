import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectCliBinary } from './cli-binary.js';

describe('cli binary inspection', () => {
  it('reports an installed binary when an executable path is provided', () => {
    const cwd = join(tmpdir(), `pa-cli-bin-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    const scriptPath = join(cwd, 'fake-cli');
    writeFileSync(scriptPath, '#!/bin/sh\necho "fake-cli 1.2.3"\n');
    chmodSync(scriptPath, 0o755);

    const result = inspectCliBinary({ command: scriptPath, cwd });
    expect(result).toEqual({
      available: true,
      command: scriptPath,
      path: scriptPath,
      version: 'fake-cli 1.2.3',
    });
  });

  it('reports a missing binary as unavailable', () => {
    const result = inspectCliBinary({ command: `missing-cli-${Date.now()}` });
    expect(result.available).toBe(false);
    expect(result.command).toContain('missing-cli-');
    expect(result.error).toBeTruthy();
  });
});
