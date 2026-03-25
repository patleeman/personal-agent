import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom';
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
import {
  COMPANION_CONVERSATIONS_PATH,
  COMPANION_MEMORIES_PATH,
  COMPANION_PROJECTS_PATH,
  COMPANION_SKILLS_PATH,
} from './routes';

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
  const location = useLocation();
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
  const showPrimaryNav = !location.pathname.startsWith(`${COMPANION_CONVERSATIONS_PATH}/`);
  const navItems = [
    { to: COMPANION_CONVERSATIONS_PATH, label: 'Chats', end: false },
    { to: COMPANION_PROJECTS_PATH, label: 'Projects', end: true },
    { to: COMPANION_MEMORIES_PATH, label: 'Memories', end: true },
    { to: COMPANION_SKILLS_PATH, label: 'Skills', end: true },
  ];

  return (
    <div className="flex h-screen flex-col bg-base text-primary">
      {!secureContext ? (
        <div className="bg-warning/10 px-4 py-2 text-[12px] text-warning">
          Installability and notifications need HTTPS. Open the companion app through your Tailscale HTTPS host for the full PWA experience.
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <Outlet context={contextValue} />
      </div>
      {showPrimaryNav ? (
        <nav className="border-t border-border-subtle bg-base/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-around gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => (
                  `flex min-w-0 flex-1 items-center justify-center rounded-xl px-2 py-2 text-[12px] font-medium transition-colors ${isActive ? 'bg-surface text-primary' : 'text-dim hover:text-primary'}`
                )}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
