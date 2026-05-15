import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  applyDesktopRuntimeEnvironmentOverrides,
  resolveDesktopRuntimeEnvironmentOverrides,
  seedTestingRuntimeState,
} from './runtime-env.js';

describe('desktop runtime environment overrides', () => {
  it('does not override stable desktop launches', () => {
    expect(resolveDesktopRuntimeEnvironmentOverrides({}, { defaultStateRoot: '/state/personal-agent' })).toEqual({});
  });

  it('isolates testing launches onto a separate state root', () => {
    expect(
      resolveDesktopRuntimeEnvironmentOverrides(
        {
          PERSONAL_AGENT_DESKTOP_VARIANT: 'testing',
        },
        { defaultStateRoot: '/state/personal-agent' },
      ),
    ).toEqual({
      stateRoot: '/state/personal-agent-testing',
    });
  });

  it('isolates packaged RC launches onto a separate state root', () => {
    expect(
      resolveDesktopRuntimeEnvironmentOverrides({}, { defaultStateRoot: '/state/personal-agent', version: '0.7.9-rc.10', packaged: true }),
    ).toEqual({
      stateRoot: '/state/personal-agent-rc',
    });
  });

  it('respects explicit user overrides in testing launches', () => {
    expect(
      resolveDesktopRuntimeEnvironmentOverrides(
        {
          PERSONAL_AGENT_DESKTOP_VARIANT: 'testing',
          PERSONAL_AGENT_STATE_ROOT: '/custom/state',
        },
        { defaultStateRoot: '/state/personal-agent' },
      ),
    ).toEqual({});
  });

  it('applies testing overrides directly onto the process environment', () => {
    const env: NodeJS.ProcessEnv = {
      PERSONAL_AGENT_DESKTOP_DEV_BUNDLE: '1',
    };

    applyDesktopRuntimeEnvironmentOverrides(env);

    expect(env.PERSONAL_AGENT_STATE_ROOT).toBeTruthy();
    expect(env.PERSONAL_AGENT_STATE_ROOT).toMatch(/personal-agent-testing$/);
    expect(env.CODEX_PORT).toBeUndefined();
    expect(env.PERSONAL_AGENT_COMPANION_PORT).toBe('0');
    expect(env.PERSONAL_AGENT_RUNTIME_CHANNEL).toBe('test');
  });

  it('applies dev overrides directly onto the process environment', () => {
    const env: NodeJS.ProcessEnv = {
      PERSONAL_AGENT_RUNTIME_CHANNEL: 'dev',
      XDG_STATE_HOME: '/state',
    };

    applyDesktopRuntimeEnvironmentOverrides(env);

    expect(env.PERSONAL_AGENT_STATE_ROOT).toBe('/state/personal-agent-dev');
    expect(env.CODEX_PORT).toBe('3848');
    expect(env.PERSONAL_AGENT_COMPANION_PORT).toBe('3844');
    expect(env.PERSONAL_AGENT_RUNTIME_CHANNEL).toBe('dev');
  });

  it('applies RC overrides directly onto the process environment', () => {
    const env: NodeJS.ProcessEnv = {
      XDG_STATE_HOME: '/state',
    };

    applyDesktopRuntimeEnvironmentOverrides(env, { version: '0.7.9-rc.10', packaged: true });

    expect(env.PERSONAL_AGENT_STATE_ROOT).toBe('/state/personal-agent-rc');
    expect(env.CODEX_PORT).toBe('3847');
    expect(env.PERSONAL_AGENT_COMPANION_PORT).toBe('3843');
    expect(env.PERSONAL_AGENT_RUNTIME_CHANNEL).toBe('rc');
  });

  it('seeds testing auth from the stable runtime when the testing auth file is empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-desktop-runtime-env-'));
    const stableAgentDir = join(root, 'personal-agent', 'pi-agent-runtime');
    const testingStateRoot = join(root, 'personal-agent-testing');
    const testingAgentDir = join(testingStateRoot, 'pi-agent-runtime');
    mkdirSync(stableAgentDir, { recursive: true });
    mkdirSync(testingAgentDir, { recursive: true });
    writeFileSync(join(stableAgentDir, 'auth.json'), JSON.stringify({ 'openai-codex': { accessToken: 'token' } }));
    writeFileSync(join(testingAgentDir, 'auth.json'), '{}');

    const env: NodeJS.ProcessEnv = {
      PERSONAL_AGENT_DESKTOP_VARIANT: 'testing',
      PERSONAL_AGENT_STATE_ROOT: testingStateRoot,
      XDG_STATE_HOME: root,
    };

    seedTestingRuntimeState(env);

    expect(JSON.parse(readFileSync(join(testingAgentDir, 'auth.json'), 'utf-8'))).toEqual({
      'openai-codex': { accessToken: 'token' },
    });
  });

  it('refreshes stable credentials without removing testing-only auth', () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-desktop-runtime-env-'));
    const stableAgentDir = join(root, 'personal-agent', 'pi-agent-runtime');
    const testingStateRoot = join(root, 'personal-agent-testing');
    const testingAgentDir = join(testingStateRoot, 'pi-agent-runtime');
    mkdirSync(stableAgentDir, { recursive: true });
    mkdirSync(testingAgentDir, { recursive: true });
    writeFileSync(join(stableAgentDir, 'auth.json'), JSON.stringify({ 'openai-codex': { accessToken: 'stable-token' } }));
    writeFileSync(
      join(testingAgentDir, 'auth.json'),
      JSON.stringify({
        'openai-codex': { accessToken: 'testing-token' },
        telegram: { type: 'api_key', key: 'telegram-token' },
      }),
    );

    const env: NodeJS.ProcessEnv = {
      PERSONAL_AGENT_DESKTOP_VARIANT: 'testing',
      PERSONAL_AGENT_STATE_ROOT: testingStateRoot,
      XDG_STATE_HOME: root,
    };

    seedTestingRuntimeState(env);

    expect(JSON.parse(readFileSync(join(testingAgentDir, 'auth.json'), 'utf-8'))).toEqual({
      'openai-codex': { accessToken: 'stable-token' },
      telegram: { type: 'api_key', key: 'telegram-token' },
    });
  });
});
