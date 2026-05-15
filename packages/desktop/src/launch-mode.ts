import { resolvePersonalAgentRuntimeChannel } from '@personal-agent/core';

type DesktopLaunchMode = 'stable' | 'rc' | 'dev' | 'testing';

export interface DesktopLaunchPresentation {
  mode: DesktopLaunchMode;
  appName: string;
  launchLabel?: string;
}

const DEFAULT_APP_NAME = 'Personal Agent';
const RC_APP_NAME = 'Personal Agent RC';
const DEV_APP_NAME = 'Personal Agent Dev';
const TESTING_APP_NAME = 'Personal Agent Testing';

export function resolveDesktopLaunchPresentation(
  env: NodeJS.ProcessEnv = process.env,
  options: { version?: string; packaged?: boolean } = {},
): DesktopLaunchPresentation {
  const channel = resolvePersonalAgentRuntimeChannel(env, options);

  if (channel === 'test') {
    return {
      mode: 'testing',
      appName: TESTING_APP_NAME,
      launchLabel: 'Testing',
    };
  }

  if (channel === 'dev') {
    return {
      mode: 'dev',
      appName: DEV_APP_NAME,
      launchLabel: 'Dev',
    };
  }

  if (channel === 'rc') {
    return {
      mode: 'rc',
      appName: RC_APP_NAME,
      launchLabel: 'RC',
    };
  }

  return {
    mode: 'stable',
    appName: DEFAULT_APP_NAME,
  };
}
