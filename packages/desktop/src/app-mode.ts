export interface DesktopAppModeController {
  setActivationPolicy?: (policy: 'regular' | 'accessory' | 'prohibited') => void | boolean;
  dock?: {
    hide?: () => void;
  };
}

export function applyDesktopShellAppMode(platform: NodeJS.Platform, appLike: DesktopAppModeController): void {
  if (platform !== 'darwin') {
    return;
  }

  appLike.setActivationPolicy?.('accessory');
  appLike.dock?.hide?.();
}
