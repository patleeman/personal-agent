import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyDesktopRuntimeEnvironmentOverrides,
  resolveDesktopRuntimeEnvironmentOverrides,
  seedTestingRuntimeState,
  TESTING_DESKTOP_COMPANION_PORT,
} from './runtime-env.js';

describe('desktop runtime environment overrides', () => {
  it('does not override stable desktop launches', () => {
    expect(resolveDesktopRuntimeEnvironmentOverrides({}, { defaultStateRoot: '/state/personal-agent' })).toEqual({});
  });

  it('isolates testing launches onto a separate state root and companion port', () => {
    expect(resolveDesktopRuntimeEnvironmentOverrides({
      PERSONAL_AGENT_DESKTOP_VARIANT: 'testing',
    }, { defaultStateRoot: '/state/personal-agent' })).toEqual({
      stateRoot: '/state/personal-agent-testing',
      companionPort: String(TESTING_DESKTOP_COMPANION_PORT),
    });
  });

  it('respects explicit user overrides in testing launches', () => {
    expect(resolveDesktopRuntimeEnvironmentOverrides({
      PERSONAL_AGENT_DESKTOP_VARIANT: 'testing',
      PERSONAL_AGENT_STATE_ROOT: '/custom/state',
      PERSONAL_AGENT_COMPANION_PORT: '4949',
    }, { defaultStateRoot: '/state/personal-agent' })).toEqual({});
  });

  it('applies testing overrides directly onto the process environment', () => {
    const env: NodeJS.ProcessEnv = {
      PERSONAL_AGENT_DESKTOP_DEV_BUNDLE: '1',
    };

    applyDesktopRuntimeEnvironmentOverrides(env);

    expect(env.PERSONAL_AGENT_STATE_ROOT).toBeTruthy();
    expect(env.PERSONAL_AGENT_STATE_ROOT).toMatch(/personal-agent-testing$/);
    expect(env.PERSONAL_AGENT_COMPANION_PORT).toBe(String(TESTING_DESKTOP_COMPANION_PORT));
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

  it('refreshes existing testing auth from stable runtime on each launch', () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-desktop-runtime-env-'));
    const stableAgentDir = join(root, 'personal-agent', 'pi-agent-runtime');
    const testingStateRoot = join(root, 'personal-agent-testing');
    const testingAgentDir = join(testingStateRoot, 'pi-agent-runtime');
    mkdirSync(stableAgentDir, { recursive: true });
    mkdirSync(testingAgentDir, { recursive: true });
    writeFileSync(join(stableAgentDir, 'auth.json'), JSON.stringify({ 'openai-codex': { accessToken: 'stable-token' } }));
    writeFileSync(join(testingAgentDir, 'auth.json'), JSON.stringify({ 'openai-codex': { accessToken: 'testing-token' } }));

    const env: NodeJS.ProcessEnv = {
      PERSONAL_AGENT_DESKTOP_VARIANT: 'testing',
      PERSONAL_AGENT_STATE_ROOT: testingStateRoot,
      XDG_STATE_HOME: root,
    };

    seedTestingRuntimeState(env);

    expect(JSON.parse(readFileSync(join(testingAgentDir, 'auth.json'), 'utf-8'))).toEqual({
      'openai-codex': { accessToken: 'stable-token' },
    });
  });
});
