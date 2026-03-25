import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { cx } from '../components/ui';
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

function ChatsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={active ? 'text-primary' : 'text-dim'} aria-hidden="true">
      <path d="M7 18.5c-2.2 0-4-1.7-4-3.8V7.8C3 5.7 4.8 4 7 4h10c2.2 0 4 1.7 4 3.8v6.9c0 2.1-1.8 3.8-4 3.8H11l-4 2.5v-2.5H7Z" />
    </svg>
  );
}

function ProjectsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={active ? 'text-primary' : 'text-dim'} aria-hidden="true">
      <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3l1.7 2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5v-9Z" />
      <path d="M3.5 9h17" />
    </svg>
  );
}

function MemoriesIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={active ? 'text-primary' : 'text-dim'} aria-hidden="true">
      <path d="M6 4.5h8a3 3 0 0 1 3 3v12l-5-2.6-5 2.6v-15Z" />
      <path d="M9 8h5" />
      <path d="M9 11h5" />
    </svg>
  );
}

function SkillsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={active ? 'text-primary' : 'text-dim'} aria-hidden="true">
      <path d="m12 3 1.8 4.7L18.5 9l-4 2.9 1.5 4.6L12 13.7 8 16.5l1.5-4.6L5.5 9l4.7-1.3L12 3Z" />
    </svg>
  );
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
    { to: COMPANION_CONVERSATIONS_PATH, label: 'Chats', end: false, ariaLabel: 'Open chats', Icon: ChatsIcon },
    { to: COMPANION_PROJECTS_PATH, label: 'Projects', end: true, ariaLabel: 'Open projects', Icon: ProjectsIcon },
    { to: COMPANION_MEMORIES_PATH, label: 'Memory', end: true, ariaLabel: 'Open memories', Icon: MemoriesIcon },
    { to: COMPANION_SKILLS_PATH, label: 'Skills', end: true, ariaLabel: 'Open skills', Icon: SkillsIcon },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-base text-primary" style={{ minHeight: '100dvh', height: '100dvh' }}>
      {!secureContext ? (
        <div className="bg-warning/10 px-4 py-2 text-[12px] text-warning">
          Installability and notifications need HTTPS. Open the companion app through your Tailscale HTTPS host for the full PWA experience.
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <Outlet context={contextValue} />
      </div>
      {showPrimaryNav ? (
        <nav className="shrink-0 border-t border-border-subtle bg-base/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] pt-2 backdrop-blur-xl">
          <div className="mx-auto grid w-full max-w-sm grid-cols-4 gap-1.5">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                aria-label={item.ariaLabel}
                className={({ isActive }) => cx(
                  'flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-medium transition-colors',
                  isActive ? 'bg-surface text-primary' : 'text-dim hover:text-primary',
                )}
              >
                {({ isActive }) => (
                  <>
                    <item.Icon active={isActive} />
                    <span className="leading-none">{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
