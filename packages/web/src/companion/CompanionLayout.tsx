import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { api } from '../api';
import { ErrorState, ToolbarButton, cx } from '../components/ui';
import { useAppData, useSystemStatus } from '../contexts';
import { useApi } from '../hooks';
import { timeAgo } from '../utils';
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
  COMPANION_INBOX_PATH,
  COMPANION_NOTES_PATH,
  COMPANION_PROJECTS_PATH,
  COMPANION_SKILLS_PATH,
  COMPANION_SYSTEM_PATH,
  COMPANION_TASKS_PATH,
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

function readDefaultDeviceLabel(): string {
  if (typeof navigator === 'undefined') {
    return 'Paired companion';
  }

  const platform = typeof navigator.platform === 'string' ? navigator.platform.trim() : '';
  return platform.length > 0 ? `${platform} companion` : 'Paired companion';
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

function InboxIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={active ? 'text-primary' : 'text-dim'} aria-hidden="true">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11Z" />
      <path d="M4 13h4l1.7 2h4.6L16 13h4" />
    </svg>
  );
}

function ChatsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={active ? 'text-primary' : 'text-dim'} aria-hidden="true">
      <path d="M7 18.5c-2.2 0-4-1.7-4-3.8V7.8C3 5.7 4.8 4 7 4h10c2.2 0 4 1.7 4 3.8v6.9c0 2.1-1.8 3.8-4 3.8H11l-4 2.5v-2.5H7Z" />
    </svg>
  );
}

function TasksIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={active ? 'text-primary' : 'text-dim'} aria-hidden="true">
      <path d="M9 6h11" />
      <path d="M9 12h11" />
      <path d="M9 18h11" />
      <path d="m4 6 1.5 1.5L7.8 5" />
      <path d="m4 12 1.5 1.5L7.8 11" />
      <path d="m4 18 1.5 1.5L7.8 17" />
    </svg>
  );
}

function MenuIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={active ? 'text-primary' : 'text-dim'} aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
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

function SystemIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={active ? 'text-primary' : 'text-dim'} aria-hidden="true">
      <path d="M12 3v6" />
      <path d="M12 15v6" />
      <path d="m6.2 6.2 4.2 4.2" />
      <path d="m13.6 13.6 4.2 4.2" />
      <path d="M3 12h6" />
      <path d="M15 12h6" />
      <path d="m6.2 17.8 4.2-4.2" />
      <path d="m13.6 10.4 4.2-4.2" />
    </svg>
  );
}

function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

function BottomNavBadge({ count, dot = false }: { count?: number; dot?: boolean }) {
  if (dot) {
    return <span className="absolute right-3 top-2 h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" />;
  }

  if (!count || count <= 0) {
    return null;
  }

  return (
    <span className="absolute right-1.5 top-1.5 min-w-[1.15rem] rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold leading-none text-accent-foreground" aria-hidden="true">
      {formatBadgeCount(count)}
    </span>
  );
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pt-5 first:pt-0">
      <h2 className="px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-dim/70">{title}</h2>
      <div className="mt-2 border-y border-border-subtle">{children}</div>
    </section>
  );
}

function DrawerLink({
  to,
  label,
  detail,
  Icon,
  onClick,
}: {
  to: string;
  label: string;
  detail?: string;
  Icon: ({ active }: { active: boolean }) => ReactNode;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end
      onClick={onClick}
      className={({ isActive }) => cx(
        'flex items-start gap-3 border-b border-border-subtle px-4 py-3.5 transition-colors last:border-b-0 hover:bg-surface/55',
        isActive ? 'bg-surface/70' : '',
      )}
    >
      {({ isActive }) => (
        <>
          <span className="mt-0.5 shrink-0"><Icon active={isActive} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium text-primary">{label}</p>
            {detail ? <p className="mt-1 text-[12px] leading-relaxed text-secondary">{detail}</p> : null}
          </div>
        </>
      )}
    </NavLink>
  );
}

export function useCompanionLayoutContext() {
  return useOutletContext<CompanionLayoutContextValue>();
}

export function CompanionLayout() {
  const location = useLocation();
  const { activity, sessions, tasks, runs } = useAppData();
  const { daemon, sync, webUi } = useSystemStatus();
  const { data: companionSession, loading: companionSessionLoading } = useApi(api.companionSession, 'companion-auth-session');
  const [pairingCode, setPairingCode] = useState('');
  const [deviceLabel, setDeviceLabel] = useState(() => readDefaultDeviceLabel());
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<DeferredInstallPromptEvent | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const [standalone, setStandalone] = useState(() => isCompanionStandalone(
    readDisplayModeStandalone(),
    readNavigatorStandalone(),
  ));
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

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

    const syncViewportHeight = () => {
      const visualViewport = window.visualViewport;
      const nextHeight = Math.round(
        (visualViewport?.height ?? window.innerHeight) + (visualViewport?.offsetTop ?? 0),
      );
      setViewportHeight((current) => (current === nextHeight ? current : nextHeight));
    };

    syncViewportHeight();
    window.addEventListener('resize', syncViewportHeight);
    window.visualViewport?.addEventListener('resize', syncViewportHeight);
    window.visualViewport?.addEventListener('scroll', syncViewportHeight);

    return () => {
      window.removeEventListener('resize', syncViewportHeight);
      window.visualViewport?.removeEventListener('resize', syncViewportHeight);
      window.visualViewport?.removeEventListener('scroll', syncViewportHeight);
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

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search]);

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

  const handleLogout = useCallback(async () => {
    if (logoutBusy) {
      return;
    }

    setLogoutBusy(true);
    try {
      await api.logoutCompanionSession();
      window.location.reload();
    } finally {
      setLogoutBusy(false);
    }
  }, [logoutBusy]);

  useCompanionNotifications({
    activity,
    sessions,
    enabled: companionSession !== null && secureContext && notificationPermission === 'granted',
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

  const showPrimaryNav = companionSession !== null && !location.pathname.startsWith(`${COMPANION_CONVERSATIONS_PATH}/`);
  const inboxBadgeCount = activity?.unreadCount ?? 0;
  const tasksBadgeCount = (tasks ?? []).filter((task) => task.running || task.lastStatus === 'failure').length;
  const menuHasAttention = (daemon?.warnings.length ?? 0) > 0
    || (sync?.warnings.length ?? 0) > 0
    || (webUi?.warnings.length ?? 0) > 0
    || ((runs?.summary.recoveryActions.resume ?? 0)
      + (runs?.summary.recoveryActions.rerun ?? 0)
      + (runs?.summary.recoveryActions.attention ?? 0)
      + (runs?.summary.recoveryActions.invalid ?? 0)) > 0;
  const menuActive = !location.pathname.startsWith(COMPANION_INBOX_PATH)
    && !location.pathname.startsWith(COMPANION_CONVERSATIONS_PATH)
    && !location.pathname.startsWith(COMPANION_TASKS_PATH);

  const navItems = [
    { to: COMPANION_INBOX_PATH, label: 'Inbox', end: false, ariaLabel: 'Open inbox', Icon: InboxIcon, badgeCount: inboxBadgeCount },
    { to: COMPANION_CONVERSATIONS_PATH, label: 'Chats', end: false, ariaLabel: 'Open chats', Icon: ChatsIcon, badgeCount: 0 },
    { to: COMPANION_TASKS_PATH, label: 'Tasks', end: false, ariaLabel: 'Open tasks', Icon: TasksIcon, badgeCount: tasksBadgeCount },
  ];

  const handlePairDevice = useCallback(async () => {
    if (authBusy) {
      return;
    }

    setAuthBusy(true);
    setAuthError(null);
    try {
      await api.exchangeCompanionPairingCode(pairingCode, deviceLabel);
      window.location.reload();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
      setAuthBusy(false);
    }
  }, [authBusy, deviceLabel, pairingCode]);

  return (
    <div
      className="flex min-h-screen flex-col bg-base text-primary"
      style={viewportHeight === null
        ? { minHeight: '100dvh', height: '100dvh' }
        : { minHeight: `${viewportHeight}px`, height: `${viewportHeight}px` }}
    >
      {!secureContext ? (
        <div className="bg-warning/10 px-4 py-2 text-[12px] text-warning">
          Installability and notifications need HTTPS. Open the companion app through your Tailscale HTTPS host for the full PWA experience.
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        {companionSession === null ? (
          companionSessionLoading ? (
            <div className="flex h-full items-center justify-center px-6">
              <p className="text-[12px] text-dim">Checking companion session…</p>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-5 py-8">
              <div className="w-full max-w-sm rounded-[28px] border border-border-subtle bg-surface/80 px-5 py-6 shadow-[0_18px_80px_rgba(15,23,42,0.18)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">Personal Agent</p>
                <h1 className="mt-3 text-[24px] font-semibold tracking-tight text-primary">Pair this device</h1>
                <p className="mt-2 text-[13px] leading-relaxed text-secondary">
                  Generate a pairing code from the local desktop web UI, or run <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-primary">pa ui pairing-code</code>, then enter it here to unlock the restricted companion service.
                </p>
                <label className="mt-5 block">
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/70">Pairing code</span>
                  <input
                    value={pairingCode}
                    onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="ABCD-EFGH-IJKL"
                    className="mt-2 w-full rounded-2xl border border-border-subtle bg-base px-4 py-3 font-mono text-[16px] tracking-[0.18em] text-primary outline-none transition focus:border-accent"
                  />
                </label>
                <label className="mt-4 block">
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/70">Device label</span>
                  <input
                    value={deviceLabel}
                    onChange={(event) => setDeviceLabel(event.target.value)}
                    autoCorrect="off"
                    spellCheck={false}
                    className="mt-2 w-full rounded-2xl border border-border-subtle bg-base px-4 py-3 text-[14px] text-primary outline-none transition focus:border-accent"
                  />
                </label>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <ToolbarButton onClick={() => { void handlePairDevice(); }} disabled={authBusy || pairingCode.trim().length === 0}>
                    {authBusy ? 'Signing in…' : 'Pair device'}
                  </ToolbarButton>
                </div>
                {authError ? <ErrorState message={authError} className="mt-4" /> : null}
              </div>
            </div>
          )
        ) : (
          <Outlet context={contextValue} />
        )}
      </div>

      {menuOpen && companionSession ? (
        <div className="fixed inset-0 z-40">
          <button type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)} className="absolute inset-0 bg-black/35" />
          <aside className="absolute inset-y-0 left-0 flex w-[min(23rem,88vw)] max-w-full flex-col border-r border-border-subtle bg-base shadow-2xl">
            <div className="border-b border-border-subtle px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.875rem)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">Personal Agent</p>
                  <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-primary">Menu</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close menu"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border-default bg-surface text-secondary transition-colors hover:text-primary"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
              <div className="mt-4 rounded-2xl bg-surface px-3 py-3">
                <p className="text-[14px] font-medium text-primary">{companionSession.session.deviceLabel}</p>
                <p className="mt-1 text-[12px] text-secondary">Paired {timeAgo(companionSession.session.createdAt)} · last used {timeAgo(companionSession.session.lastUsedAt)}</p>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-0 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              <DrawerSection title="Operational">
                <DrawerLink to={COMPANION_SYSTEM_PATH} label="System" detail="Daemon, sync, web UI status, and safe controls." Icon={SystemIcon} onClick={() => setMenuOpen(false)} />
              </DrawerSection>

              <DrawerSection title="Browse">
                <DrawerLink to={COMPANION_PROJECTS_PATH} label="Projects" detail="Read current focus, blockers, notes, and linked conversations." Icon={ProjectsIcon} onClick={() => setMenuOpen(false)} />
                <DrawerLink to={COMPANION_NOTES_PATH} label="Notes" detail="Browse durable note nodes and references." Icon={MemoriesIcon} onClick={() => setMenuOpen(false)} />
                <DrawerLink to={COMPANION_SKILLS_PATH} label="Skills" detail="Review reusable workflows and invoke them from chats." Icon={SkillsIcon} onClick={() => setMenuOpen(false)} />
              </DrawerSection>

              <DrawerSection title="Companion">
                {contextValue.installAvailable ? (
                  <button
                    type="button"
                    onClick={() => { void promptInstall(); }}
                    disabled={installBusy}
                    className="flex w-full items-start gap-3 border-b border-border-subtle px-4 py-3.5 text-left transition-colors hover:bg-surface/55 disabled:cursor-default disabled:opacity-50"
                  >
                    <span className="mt-0.5 shrink-0"><InboxIcon active /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium text-primary">{installBusy ? 'Installing companion…' : 'Install app'}</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-secondary">Add Pi to your home screen for a better mobile experience.</p>
                    </div>
                  </button>
                ) : null}
                {contextValue.notificationsSupported && contextValue.notificationPermission === 'default' ? (
                  <button
                    type="button"
                    onClick={() => { void requestNotificationPermission(); }}
                    className="flex w-full items-start gap-3 border-b border-border-subtle px-4 py-3.5 text-left transition-colors hover:bg-surface/55"
                  >
                    <span className="mt-0.5 shrink-0"><TasksIcon active /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium text-primary">Enable notifications</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-secondary">Get alerts for approvals, failures, and activity that needs attention.</p>
                    </div>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => { void handleLogout(); }}
                  disabled={logoutBusy}
                  className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface/55 disabled:cursor-default disabled:opacity-50"
                >
                  <span className="mt-0.5 shrink-0"><MenuIcon active /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-primary">{logoutBusy ? 'Signing out…' : 'Sign out this device'}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-secondary">Revoke the current companion session from this browser.</p>
                  </div>
                </button>
              </DrawerSection>
            </div>
          </aside>
        </div>
      ) : null}

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
                  'relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-medium transition-colors',
                  isActive ? 'bg-surface text-primary' : 'text-dim hover:text-primary',
                )}
              >
                {({ isActive }) => (
                  <>
                    <item.Icon active={isActive} />
                    <span className="leading-none">{item.label}</span>
                    <BottomNavBadge count={item.badgeCount} />
                  </>
                )}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              className={cx(
                'relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-medium transition-colors',
                menuActive || menuOpen ? 'bg-surface text-primary' : 'text-dim hover:text-primary',
              )}
            >
              <MenuIcon active={menuActive || menuOpen} />
              <span className="leading-none">Menu</span>
              <BottomNavBadge dot={menuHasAttention} />
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
