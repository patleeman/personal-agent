import type { NativeImage } from 'electron';

export interface DesktopApplicationIconController {
  dock?: {
    setIcon?: (image: string | NativeImage) => void;
  };
}

export function applyDesktopApplicationIcon(
  platform: NodeJS.Platform,
  appLike: DesktopApplicationIconController,
  icon: string | NativeImage,
): void {
  if (platform !== 'darwin') {
    return;
  }

  appLike.dock?.setIcon?.(icon);
}
