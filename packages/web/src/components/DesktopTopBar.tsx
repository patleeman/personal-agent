import { type CSSProperties, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getDesktopBridge, isDesktopShell } from '../desktop/desktopBridge';
import type { DesktopEnvironmentState, DesktopNavigationState } from '../shared/types';
import { ToolbarButton } from './ui';
import type { AppLayoutMode } from '../ui-state/appLayoutMode';

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

function ZenViewIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
      <path d="M7 2.2v2" />
      <path d="M7 9.8v2" />
      <path d="M2.2 7h2" />
      <path d="M9.8 7h2" />
      <circle cx="7" cy="7" r="2.4" />
    </svg>
  );
}

function readPersistedNavigationIndex(value: string | null, fallback: number): number {
  if (value === null) {
    return fallback;
  }

  const normalized = value.trim();
  return /^\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : Number.NaN;
}

export function readBrowserNavigationState(): DesktopNavigationState {
  if (typeof window === 'undefined') {
    return { canGoBack: false, canGoForward: false };
  }

  const rawIndex = (window.history.state as { idx?: unknown } | null | undefined)?.idx;
  const currentIndex = typeof rawIndex === 'number' && Number.isSafeInteger(rawIndex) && rawIndex >= 0 ? rawIndex : 0;
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

export function DesktopTopBar({
  environment,
  sidebarOpen,
  onToggleSidebar,
  showRailToggle,
  railOpen,
  onToggleRail,
  layoutMode,
  onLayoutModeChange,
  onZenModeChange,
  zenMode = false,
}: {
  environment: DesktopEnvironmentState | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  showRailToggle: boolean;
  railOpen: boolean;
  onToggleRail: () => void;
  layoutMode: AppLayoutMode;
  onLayoutModeChange: (mode: AppLayoutMode) => void;
  onZenModeChange?: (enabled: boolean) => void;
  zenMode?: boolean;
}) {
  const location = useLocation();
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
    bridge.getNavigationState()
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
  const launchBadgeLabel = environment?.launchMode === 'testing'
    ? environment.launchLabel?.trim() || 'Testing'
    : null;

  return (
    <div className="ui-desktop-top-bar border-b-0 bg-base/80">
      <div className="ui-desktop-top-bar__drag-region" />
      <div className="ui-desktop-top-bar__leading">
        <div className="ui-desktop-top-bar__traffic-light-gap" aria-hidden="true" />
        <div className="ui-desktop-top-bar__controls" style={noDragStyle}>
          {!zenMode ? (
            <ToolbarButton
              className="ui-desktop-top-bar__icon-button"
              onClick={onToggleSidebar}
              aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
              title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              <LeftSidebarToggleIcon open={sidebarOpen} />
            </ToolbarButton>
          ) : null}
          <ToolbarButton className="ui-desktop-top-bar__icon-button" onClick={() => { void handleBack(); }} disabled={!navigation.canGoBack} aria-label="Go back" title="Go back">
            ←
          </ToolbarButton>
          <ToolbarButton className="ui-desktop-top-bar__icon-button" onClick={() => { void handleForward(); }} disabled={!navigation.canGoForward} aria-label="Go forward" title="Go forward">
            →
          </ToolbarButton>
        </div>
        {launchBadgeLabel ? (
          <div className="ui-desktop-top-bar__mode-badge" title="Launched from the command line">
            {launchBadgeLabel}
          </div>
        ) : null}
      </div>
      <div className="ui-desktop-top-bar__center" />
      <div className="ui-desktop-top-bar__trailing" style={noDragStyle}>
        <div className="ui-desktop-layout-switcher" role="radiogroup" aria-label="View mode">
          <button
            type="button"
            className="ui-desktop-layout-switcher__button"
            role="radio"
            aria-checked={!zenMode && layoutMode === 'compact'}
            title="Compact view"
            onClick={() => {
              onZenModeChange?.(false);
              onLayoutModeChange('compact');
            }}
          >
            <CompactViewIcon />
            <span>Compact</span>
          </button>
          <button
            type="button"
            className="ui-desktop-layout-switcher__button"
            role="radio"
            aria-checked={!zenMode && layoutMode === 'workbench'}
            title="Workbench view"
            onClick={() => {
              onZenModeChange?.(false);
              onLayoutModeChange('workbench');
            }}
          >
            <WorkbenchViewIcon />
            <span>Workbench</span>
          </button>
          <button
            type="button"
            className="ui-desktop-layout-switcher__button"
            role="radio"
            aria-checked={zenMode}
            title="Zen view"
            onClick={() => onZenModeChange?.(true)}
          >
            <ZenViewIcon />
            <span>Zen</span>
          </button>
        </div>
        {showRailToggle ? (
          <ToolbarButton
            className="ui-desktop-top-bar__icon-button"
            onClick={onToggleRail}
            aria-label={railOpen ? 'Hide right sidebar' : 'Show right sidebar'}
            title={railOpen ? 'Hide right sidebar' : 'Show right sidebar'}
          >
            <RightRailToggleIcon open={railOpen} />
          </ToolbarButton>
        ) : null}
      </div>
    </div>
  );
}
