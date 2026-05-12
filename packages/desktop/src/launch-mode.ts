type DesktopLaunchMode = 'stable' | 'rc' | 'testing';

export interface DesktopLaunchPresentation {
  mode: DesktopLaunchMode;
  appName: string;
  launchLabel?: string;
}

const DEFAULT_APP_NAME = 'Personal Agent';
const RC_APP_NAME = 'Personal Agent RC';
const TESTING_APP_NAME = 'Personal Agent Testing';

function isRcVersion(version?: string): boolean {
  return typeof version === 'string' && /-rc(?:\.|$)/iu.test(version);
}

export function resolveDesktopLaunchPresentation(
  env: NodeJS.ProcessEnv = process.env,
  options: { version?: string; packaged?: boolean } = {},
): DesktopLaunchPresentation {
  const rawVariant = env.PERSONAL_AGENT_DESKTOP_VARIANT?.trim().toLowerCase();

  if (rawVariant === 'testing' || env.PERSONAL_AGENT_DESKTOP_DEV_BUNDLE === '1') {
    return {
      mode: 'testing',
      appName: TESTING_APP_NAME,
      launchLabel: 'Testing',
    };
  }

  if (rawVariant === 'rc' || (options.packaged && isRcVersion(options.version))) {
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
