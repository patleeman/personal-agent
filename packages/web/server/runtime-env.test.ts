import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyWebRuntimeEnvironmentOverrides,
  DEFAULT_WEB_RUNTIME_PORT,
  resolveWebRuntimeEnvironmentOverrides,
  seedTestingRuntimeState,
} from './runtime-env.js';

describe('web runtime environment overrides', () => {
  it('does not override the stable web runtime port', () => {
    expect(resolveWebRuntimeEnvironmentOverrides({}, { defaultStateRoot: '/state/personal-agent' })).toEqual({});
    expect(resolveWebRuntimeEnvironmentOverrides({
      PA_WEB_PORT: String(DEFAULT_WEB_RUNTIME_PORT),
    }, { defaultStateRoot: '/state/personal-agent' })).toEqual({});
  });

  it('isolates non-default web ports onto a testing state root', () => {
    expect(resolveWebRuntimeEnvironmentOverrides({
      PA_WEB_PORT: '41745',
    }, { defaultStateRoot: '/state/personal-agent' })).toEqual({
      stateRoot: '/state/personal-agent-testing/web-41745',
    });
  });

  it('respects explicit runtime root overrides for testing web launches', () => {
    expect(resolveWebRuntimeEnvironmentOverrides({
      PA_WEB_PORT: '41745',
      PERSONAL_AGENT_STATE_ROOT: '/custom/state',
    }, { defaultStateRoot: '/state/personal-agent' })).toEqual({});

    expect(resolveWebRuntimeEnvironmentOverrides({
      PA_WEB_PORT: '41745',
      PERSONAL_AGENT_CONFIG_ROOT: '/custom/config',
    }, { defaultStateRoot: '/state/personal-agent' })).toEqual({});

    expect(resolveWebRuntimeEnvironmentOverrides({
      PA_WEB_PORT: '41745',
      PERSONAL_AGENT_CONFIG_FILE: '/custom/config.json',
    }, { defaultStateRoot: '/state/personal-agent' })).toEqual({});
  });

  it('applies testing overrides directly onto the process environment', () => {
    const env: NodeJS.ProcessEnv = {
      PA_WEB_PORT: '41745',
    };

    applyWebRuntimeEnvironmentOverrides(env);

    expect(env.PERSONAL_AGENT_STATE_ROOT).toBeTruthy();
    expect(env.PERSONAL_AGENT_STATE_ROOT).toMatch(/personal-agent-testing\/web-41745$/);
  });

  it('seeds testing auth from the stable runtime when the testing auth file is empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-web-runtime-env-'));
    const stableAgentDir = join(root, 'personal-agent', 'pi-agent-runtime');
    const testingStateRoot = join(root, 'personal-agent-testing', 'web-41745');
    const testingAgentDir = join(testingStateRoot, 'pi-agent-runtime');
    mkdirSync(stableAgentDir, { recursive: true });
    mkdirSync(testingAgentDir, { recursive: true });
    writeFileSync(join(stableAgentDir, 'auth.json'), JSON.stringify({ 'openai-codex': { accessToken: 'token' } }));
    writeFileSync(join(testingAgentDir, 'auth.json'), '{}');

    const env: NodeJS.ProcessEnv = {
      PA_WEB_PORT: '41745',
      PERSONAL_AGENT_STATE_ROOT: testingStateRoot,
      XDG_STATE_HOME: root,
    };

    seedTestingRuntimeState(env);

    expect(JSON.parse(readFileSync(join(testingAgentDir, 'auth.json'), 'utf-8'))).toEqual({
      'openai-codex': { accessToken: 'token' },
    });
  });
});
