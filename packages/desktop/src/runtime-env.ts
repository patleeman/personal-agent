import { basename, dirname, join } from 'node:path';
import { getDefaultStateRoot } from '@personal-agent/core';
import { resolveDesktopLaunchPresentation } from './launch-mode.js';

export const TESTING_DESKTOP_COMPANION_PORT = 3844;

function resolveTestingStateRoot(defaultStateRoot: string): string {
  return join(dirname(defaultStateRoot), `${basename(defaultStateRoot)}-testing`);
}

export function resolveDesktopRuntimeEnvironmentOverrides(
  env: NodeJS.ProcessEnv = process.env,
  options: { defaultStateRoot?: string } = {},
): {
  stateRoot?: string;
  companionPort?: string;
} {
  const launchPresentation = resolveDesktopLaunchPresentation(env);

  if (launchPresentation.mode !== 'testing') {
    return {};
  }

  return {
    ...(env.PERSONAL_AGENT_STATE_ROOT?.trim()
      ? {}
      : { stateRoot: resolveTestingStateRoot(options.defaultStateRoot ?? getDefaultStateRoot()) }),
    ...(env.PERSONAL_AGENT_COMPANION_PORT?.trim()
      ? {}
      : { companionPort: String(TESTING_DESKTOP_COMPANION_PORT) }),
  };
}

export function applyDesktopRuntimeEnvironmentOverrides(env: NodeJS.ProcessEnv = process.env): void {
  const overrides = resolveDesktopRuntimeEnvironmentOverrides(env);

  if (overrides.stateRoot) {
    env.PERSONAL_AGENT_STATE_ROOT = overrides.stateRoot;
  }

  if (overrides.companionPort) {
    env.PERSONAL_AGENT_COMPANION_PORT = overrides.companionPort;
  }
}
