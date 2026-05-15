import type { App } from 'electron';

export interface DesktopSingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  on(event: 'second-instance', listener: () => void): App;
  exit(code?: number): void;
}

export function claimDesktopSingleInstance(app: DesktopSingleInstanceApp, onSecondInstance: () => void): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.exit(0);
    return false;
  }

  app.on('second-instance', onSecondInstance);
  return true;
}
