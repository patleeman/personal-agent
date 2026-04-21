import { describe, expect, it } from 'vitest';
import {
  applyDesktopRuntimeEnvironmentOverrides,
  resolveDesktopRuntimeEnvironmentOverrides,
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
});
