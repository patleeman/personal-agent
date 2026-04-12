export interface DesktopAppModeController {
  setActivationPolicy?: (policy: 'regular' | 'accessory' | 'prohibited') => void | boolean;
  dock?: {
    show?: () => void | Promise<void>;
    hide?: () => void;
  };
}

function enterDesktopBackgroundAppMode(appLike: DesktopAppModeController): void {
  appLike.setActivationPolicy?.('accessory');
  appLike.dock?.hide?.();
}

function enterDesktopForegroundAppMode(appLike: DesktopAppModeController): void {
  appLike.setActivationPolicy?.('regular');
  void appLike.dock?.show?.();
}

export function syncDesktopShellAppModeForWindows(
  platform: NodeJS.Platform,
  appLike: DesktopAppModeController,
  hasVisibleWindows: boolean,
): void {
  if (platform !== 'darwin') {
    return;
  }

  if (hasVisibleWindows) {
    enterDesktopForegroundAppMode(appLike);
    return;
  }

  enterDesktopBackgroundAppMode(appLike);
}

export function applyDesktopShellAppMode(platform: NodeJS.Platform, appLike: DesktopAppModeController): void {
  syncDesktopShellAppModeForWindows(platform, appLike, false);
}
