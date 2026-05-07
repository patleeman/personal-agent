type DesktopLaunchMode = 'stable' | 'testing';

export interface DesktopLaunchPresentation {
  mode: DesktopLaunchMode;
  appName: string;
  launchLabel?: string;
}

const DEFAULT_APP_NAME = 'Personal Agent';
const TESTING_APP_NAME = 'Personal Agent Testing';

export function resolveDesktopLaunchPresentation(env: NodeJS.ProcessEnv = process.env): DesktopLaunchPresentation {
  const rawVariant = env.PERSONAL_AGENT_DESKTOP_VARIANT?.trim().toLowerCase();

  if (rawVariant === 'testing' || env.PERSONAL_AGENT_DESKTOP_DEV_BUNDLE === '1') {
    return {
      mode: 'testing',
      appName: TESTING_APP_NAME,
      launchLabel: 'Testing',
    };
  }

  return {
    mode: 'stable',
    appName: DEFAULT_APP_NAME,
  };
}
