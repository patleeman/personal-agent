import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWebUiConfig, writeWebUiConfig } from './webUi.js';

const DEFAULT_RESUME_FALLBACK_PROMPT = 'Continue from where you left off.';
const tempDirs: string[] = [];
const originalEnv = process.env;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('web UI config', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PA_WEB_COMPANION_PORT;
    delete process.env.PERSONAL_AGENT_WEB_TAILSCALE_SERVE;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('uses the default companion port and resume fallback prompt when no config file exists', () => {
    const configDir = createTempDir('pa-web-ui-config-');
    process.env.PERSONAL_AGENT_WEB_CONFIG_FILE = join(configDir, 'web.json');

    const config = readWebUiConfig();
    expect(config.companionPort).toBe(3742);
    expect(config.resumeFallbackPrompt).toBe(DEFAULT_RESUME_FALLBACK_PROMPT);
  });

  it('persists a custom companion port and resume fallback prompt', () => {
    const configDir = createTempDir('pa-web-ui-config-');
    process.env.PERSONAL_AGENT_WEB_CONFIG_FILE = join(configDir, 'web.json');

    writeWebUiConfig({ companionPort: 4800, resumeFallbackPrompt: '  Pick up from the last successful step.  ' });

    const config = readWebUiConfig();
    expect(config.companionPort).toBe(4800);
    expect(config.resumeFallbackPrompt).toBe('Pick up from the last successful step.');
  });

  it('normalizes blank resume fallback prompts back to default', () => {
    const configDir = createTempDir('pa-web-ui-config-');
    process.env.PERSONAL_AGENT_WEB_CONFIG_FILE = join(configDir, 'web.json');

    writeWebUiConfig({ resumeFallbackPrompt: '' });

    const config = readWebUiConfig();
    expect(config.resumeFallbackPrompt).toBe(DEFAULT_RESUME_FALLBACK_PROMPT);
  });
});
