import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useOutletContext } from 'react-router-dom';
import { useAppData } from '../contexts';
import { useCompanionNotifications } from './useCompanionNotifications';
import {
  canPromptCompanionInstall,
  COMPANION_SCOPE_PATH,
  COMPANION_SERVICE_WORKER_PATH,
  type DeferredInstallPromptEvent,
  isCompanionSecureContext,
  isCompanionStandalone,
} from './pwa';

export interface CompanionLayoutContextValue {
  secureContext: boolean;
  standalone: boolean;
  installAvailable: boolean;
  installBusy: boolean;
  promptInstall: () => Promise<void>;
  notificationsSupported: boolean;
  notificationPermission: NotificationPermission | 'unsupported';
  requestNotificationPermission: () => Promise<void>;
}

function readDisplayModeStandalone(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

function readNavigatorStandalone(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function useCompanionLayoutContext() {
  return useOutletContext<CompanionLayoutContextValue>();
}

export function CompanionLayout() {
  const { activity, sessions } = useAppData();
  const [deferredPrompt, setDeferredPrompt] = useState<DeferredInstallPromptEvent | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const [standalone, setStandalone] = useState(() => isCompanionStandalone(
    readDisplayModeStandalone(),
    readNavigatorStandalone(),
  ));

  const secureContext = useMemo(() => {
    if (typeof window === 'undefined') {
      return true;
    }

    return isCompanionSecureContext(window.location, window.isSecureContext);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    let mediaQuery: MediaQueryList | null = null;
    const syncNotificationPermission = () => {
      setNotificationPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
    };
    const syncStandaloneState = () => {
      setStandalone(isCompanionStandalone(readDisplayModeStandalone(), readNavigatorStandalone()));
    };

    syncStandaloneState();
    try {
      mediaQuery = window.matchMedia('(display-mode: standalone)');
      if ('addEventListener' in mediaQuery) {
        mediaQuery.addEventListener('change', syncStandaloneState);
      } else {
        mediaQuery.addListener(syncStandaloneState);
      }
    } catch {
      // Ignore media-query failures and keep the fallback state.
    }

    const handleAppInstalled = () => {
      setStandalone(true);
      setDeferredPrompt(null);
    };

    syncNotificationPermission();
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('focus', syncNotificationPermission);
    document.addEventListener('visibilitychange', syncNotificationPermission);

    return () => {
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('focus', syncNotificationPermission);
      document.removeEventListener('visibilitychange', syncNotificationPermission);
      if (!mediaQuery) {
        return;
      }

      if ('removeEventListener' in mediaQuery) {
        mediaQuery.removeEventListener('change', syncStandaloneState);
      } else {
        mediaQuery.removeListener(syncStandaloneState);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as DeferredInstallPromptEvent;
      event.preventDefault();
      setDeferredPrompt(promptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!secureContext || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    navigator.serviceWorker.register(COMPANION_SERVICE_WORKER_PATH, { scope: COMPANION_SCOPE_PATH }).catch(() => {
      // Ignore registration failures; the companion surface still works without offline installability.
    });
  }, [secureContext]);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt || installBusy) {
      return;
    }

    setInstallBusy(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } finally {
      setInstallBusy(false);
    }
  }, [deferredPrompt, installBusy]);

  const requestNotificationPermission = useCallback(async () => {
    if (typeof Notification === 'undefined' || notificationPermission !== 'default') {
      return;
    }

    const nextPermission = await Notification.requestPermission();
    setNotificationPermission(nextPermission);
  }, [notificationPermission]);

  useCompanionNotifications({
    activity,
    sessions,
    enabled: secureContext && notificationPermission === 'granted',
  });

  const contextValue = useMemo<CompanionLayoutContextValue>(() => ({
    secureContext,
    standalone,
    installAvailable: canPromptCompanionInstall({
      secureContext,
      standalone,
      hasDeferredPrompt: Boolean(deferredPrompt),
    }),
    installBusy,
    promptInstall,
    notificationsSupported: typeof Notification !== 'undefined',
    notificationPermission,
    requestNotificationPermission,
  }), [deferredPrompt, installBusy, notificationPermission, promptInstall, requestNotificationPermission, secureContext, standalone]);

  return (
    <div className="flex h-screen flex-col bg-base text-primary">
      {!secureContext ? (
        <div className="bg-warning/10 px-4 py-2 text-[12px] text-warning">
          Installability and notifications need HTTPS. Open the companion app through your Tailscale HTTPS host for the full PWA experience.
        </div>
      ) : null}
      <Outlet context={contextValue} />
    </div>
  );
}
