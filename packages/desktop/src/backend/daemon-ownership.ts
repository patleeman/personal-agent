export type DesktopDaemonOwnership = 'owned' | 'external';

const DESKTOP_DAEMON_OWNERSHIP_ENV = 'PERSONAL_AGENT_DESKTOP_DAEMON_OWNERSHIP';

export function readDesktopDaemonOwnership(env: NodeJS.ProcessEnv = process.env): DesktopDaemonOwnership | undefined {
  const value = env[DESKTOP_DAEMON_OWNERSHIP_ENV]?.trim().toLowerCase();
  if (value === 'owned' || value === 'external') {
    return value;
  }

  return undefined;
}

export function writeDesktopDaemonOwnership(ownership: DesktopDaemonOwnership | undefined, env: NodeJS.ProcessEnv = process.env): void {
  if (!ownership) {
    delete env[DESKTOP_DAEMON_OWNERSHIP_ENV];
    return;
  }

  env[DESKTOP_DAEMON_OWNERSHIP_ENV] = ownership;
}

export function clearDesktopDaemonOwnership(env: NodeJS.ProcessEnv = process.env): void {
  delete env[DESKTOP_DAEMON_OWNERSHIP_ENV];
}
