export const COMPANION_PATH_PREFIX = '/app';
export const COMPANION_SCOPE_PATH = '/app/';
export const COMPANION_MANIFEST_PATH = '/app/manifest.webmanifest';
export const COMPANION_SERVICE_WORKER_PATH = '/app/sw.js';

export interface CompanionLocationLike {
  protocol: string;
  hostname: string;
}

export interface DeferredInstallPromptChoice {
  outcome: 'accepted' | 'dismissed';
  platform: string;
}

export interface DeferredInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<DeferredInstallPromptChoice>;
}

export function isCompanionPath(pathname: string | null | undefined): boolean {
  return pathname === COMPANION_PATH_PREFIX || pathname?.startsWith(COMPANION_SCOPE_PATH) === true;
}

export function isCompanionSecureContext(
  location: CompanionLocationLike,
  secureContext: boolean,
): boolean {
  if (secureContext) {
    return true;
  }

  if (location.protocol === 'https:') {
    return true;
  }

  return location.hostname === 'localhost'
    || location.hostname === '127.0.0.1'
    || location.hostname === '::1';
}

export function isCompanionStandalone(
  displayModeStandalone: boolean,
  navigatorStandalone: boolean,
): boolean {
  return displayModeStandalone || navigatorStandalone;
}

export function canPromptCompanionInstall(input: {
  secureContext: boolean;
  standalone: boolean;
  hasDeferredPrompt: boolean;
}): boolean {
  return input.secureContext && !input.standalone && input.hasDeferredPrompt;
}
