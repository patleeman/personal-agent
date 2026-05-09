import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { api } from '../client/api';
import { getDesktopBridge, isDesktopShell } from '../desktop/desktopBridge';
import type { DaemonPowerSummary, DesktopEnvironmentState, DesktopNavigationState } from '../shared/types';
import type { AppLayoutMode } from '../ui-state/appLayoutMode';
import { ToolbarButton } from './ui';

function LeftSidebarToggleIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1.5" y="2" width="11" height="10" rx="1.8" />
      <path d="M4.75 2v10" />
      {open ? <path d="M6 7h2.5" /> : <path d="M7.9 5.4 6.2 7l1.7 1.6" />}
    </svg>
  );
}

function RightRailToggleIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1.5" y="2" width="11" height="10" rx="1.8" />
      <path d="M9.25 2v10" />
      {open ? <path d="M8 7H5.5" /> : <path d="M6.1 5.4 7.8 7l-1.7 1.6" />}
    </svg>
  );
}

function CompactViewIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
      <rect x="2" y="2.5" width="10" height="9" rx="1.8" />
      <path d="M4.5 5h5" />
      <path d="M4.5 7h4" />
      <path d="M4.5 9h3" />
    </svg>
  );
}

function WorkbenchViewIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
      <rect x="1.7" y="2.3" width="10.6" height="9.4" rx="1.7" />
      <path d="M4.8 2.3v9.4" />
      <path d="M9.1 2.3v9.4" />
    </svg>
  );
}

const MAX_BROWSER_NAVIGATION_INDEX = 10_000;

function isSafeNavigationIndex(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_BROWSER_NAVIGATION_INDEX;
}

function readPersistedNavigationIndex(value: string | null, fallback: number): number {
  if (value === null) {
    return fallback;
  }

  const normalized = value.trim();
  const parsed = /^\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : Number.NaN;
  return isSafeNavigationIndex(parsed) ? parsed : fallback;
}

export function readBrowserNavigationState(): DesktopNavigationState {
  if (typeof window === 'undefined') {
    return { canGoBack: false, canGoForward: false };
  }

  const rawIndex = (window.history.state as { idx?: unknown } | null | undefined)?.idx;
  const currentIndex = typeof rawIndex === 'number' && isSafeNavigationIndex(rawIndex) ? rawIndex : 0;
  let maxIndex = currentIndex;

  try {
    const stored = readPersistedNavigationIndex(window.sessionStorage.getItem('__pa_nav_max_idx__'), currentIndex);
    if (Number.isSafeInteger(stored) && stored >= 0) {
      maxIndex = Math.max(currentIndex, stored);
    }
    window.sessionStorage.setItem('__pa_nav_max_idx__', String(maxIndex));
  } catch {
    maxIndex = currentIndex;
  }

  return {
    canGoBack: currentIndex > 0,
    canGoForward: currentIndex < maxIndex,
  };
}

function CaffeineIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 2.5v6a3 3 0 0 0 3 3h3a3 3 0 0 0 3-3v-6Z" />
      <path d="M11.5 4.5h1a1.5 1.5 0 0 1 0 3h-1" />
      <path d="M5 13.5h4" />
      <path d="M7 13.5v-2" />
    </svg>
  );
}

const DAEMON_POWER_POLL_MS = 30_000;

function useDaemonPower(): DaemonPowerSummary | null {
  const [power, setPower] = useState<DaemonPowerSummary | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    async function fetchPower() {
      try {
        const state = await api.daemon();
        if (mountedRef.current) {
          setPower(state.power);
        }
      } catch {
        if (mountedRef.current) {
          setPower(null);
        }
      }
    }

    void fetchPower();

    function poll() {
      pollTimer = setTimeout(async () => {
        await fetchPower();
        if (mountedRef.current) {
          poll();
        }
      }, DAEMON_POWER_POLL_MS);
    }

    poll();

    return () => {
      mountedRef.current = false;
      if (pollTimer !== null) {
        clearTimeout(pollTimer);
      }
    };
  }, []);

  return power;
}

export function DesktopTopBar({
  environment,
  sidebarOpen,
  onToggleSidebar,
  showRailToggle,
  railOpen,
  onToggleRail,
  layoutMode,
  onLayoutModeChange,
}: {
  environment: DesktopEnvironmentState | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  showRailToggle: boolean;
  railOpen: boolean;
  onToggleRail: () => void;
  layoutMode: AppLayoutMode;
  onLayoutModeChange: (mode: AppLayoutMode) => void;
}) {
  const location = useLocation();
  const daemonPower = useDaemonPower();
  const [navigation, setNavigation] = useState<DesktopNavigationState>({
    canGoBack: false,
    canGoForward: false,
  });

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setNavigation(readBrowserNavigationState());
      return;
    }

    let cancelled = false;
    bridge
      .getNavigationState()
      .then((state) => {
        if (!cancelled) {
          setNavigation(state);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNavigation({ canGoBack: false, canGoForward: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [location.key, location.pathname, location.search]);

  const bridge = getDesktopBridge();
  const desktopShell = isDesktopShell();
  const showDesktopChrome = bridge !== null || environment !== null || desktopShell;

  if (!showDesktopChrome) {
    return null;
  }

  async function handleBack() {
    if (!bridge) {
      window.history.back();
      window.setTimeout(() => {
        setNavigation(readBrowserNavigationState());
      }, 120);
      return;
    }

    const state = await bridge.goBack();
    setNavigation(state);
  }

  async function handleForward() {
    if (!bridge) {
      window.history.forward();
      window.setTimeout(() => {
        setNavigation(readBrowserNavigationState());
      }, 120);
      return;
    }

    const state = await bridge.goForward();
    setNavigation(state);
  }

  const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;
  const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
  const launchBadgeLabel = environment?.launchMode === 'testing' ? environment.launchLabel?.trim() || 'Testing' : null;

  const caffinating = daemonPower?.keepAwake === true && daemonPower?.active === true;
  const powerTooltip = caffinating
    ? 'Idle system sleep is blocked. Display sleep is still allowed.'
    : daemonPower?.keepAwake === true
      ? `Keep-awake is enabled but inactive${daemonPower?.error ? `: ${daemonPower.error}` : ''}.`
      : null;

  return (
    <div className="ui-desktop-top-bar border-b-0 bg-base/80">
      <div className="ui-desktop-top-bar__leading">
        <div className="ui-desktop-top-bar__traffic-light-gap" aria-hidden="true" style={dragStyle} />
        <div className="ui-desktop-top-bar__controls" style={noDragStyle}>
          <ToolbarButton
            className="ui-desktop-top-bar__icon-button"
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            <LeftSidebarToggleIcon open={sidebarOpen} />
          </ToolbarButton>
          <ToolbarButton
            className="ui-desktop-top-bar__icon-button"
            onClick={() => {
              void handleBack();
            }}
            disabled={!navigation.canGoBack}
            aria-label="Go back"
            title="Go back"
          >
            ←
          </ToolbarButton>
          <ToolbarButton
            className="ui-desktop-top-bar__icon-button"
            onClick={() => {
              void handleForward();
            }}
            disabled={!navigation.canGoForward}
            aria-label="Go forward"
            title="Go forward"
          >
            →
          </ToolbarButton>
        </div>
        {launchBadgeLabel ? (
          <div className="ui-desktop-top-bar__mode-badge" title="Launched from the command line">
            {launchBadgeLabel}
          </div>
        ) : null}
      </div>
      <div className="ui-desktop-top-bar__center" style={dragStyle} />
      <div className="ui-desktop-top-bar__trailing" style={noDragStyle}>
        {daemonPower !== null && daemonPower.keepAwake ? (
          <div
            className={`ui-desktop-top-bar__icon-button ui-desktop-top-bar__caffeine-indicator ${caffinating ? 'ui-desktop-top-bar__caffeine-active' : ''}`}
            aria-label={caffinating ? 'Caffinating — system sleep blocked' : 'Keep-awake enabled'}
            title={powerTooltip ?? ''}
          >
            <CaffeineIcon />
          </div>
        ) : null}
        <div className="ui-desktop-layout-switcher" role="radiogroup" aria-label="View mode">
          <button
            type="button"
            className="ui-desktop-layout-switcher__button"
            role="radio"
            aria-checked={layoutMode === 'compact'}
            aria-label="Compact"
            title="Compact view"
            onClick={() => {
              onLayoutModeChange('compact');
            }}
          >
            <CompactViewIcon />
          </button>
          <button
            type="button"
            className="ui-desktop-layout-switcher__button"
            role="radio"
            aria-checked={layoutMode === 'workbench'}
            aria-label="Workbench"
            title="Workbench view"
            onClick={() => {
              onLayoutModeChange('workbench');
            }}
          >
            <WorkbenchViewIcon />
          </button>
        </div>
        <ToolbarButton
          className="ui-desktop-top-bar__icon-button"
          onClick={onToggleRail}
          disabled={!showRailToggle}
          aria-label={showRailToggle ? (railOpen ? 'Collapse right sidebar' : 'Expand right sidebar') : 'Right sidebar unavailable'}
          title={showRailToggle ? (railOpen ? 'Collapse right sidebar' : 'Expand right sidebar') : 'Right sidebar unavailable'}
        >
          <RightRailToggleIcon open={showRailToggle ? railOpen : false} />
        </ToolbarButton>
      </div>
    </div>
  );
}
