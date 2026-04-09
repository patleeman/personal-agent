import { type CSSProperties, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getDesktopBridge, isDesktopShell } from '../desktopBridge';
import type { DesktopEnvironmentState, DesktopNavigationState } from '../types';
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

function readBrowserNavigationState(): DesktopNavigationState {
  if (typeof window === 'undefined') {
    return { canGoBack: false, canGoForward: false };
  }

  const rawIndex = (window.history.state as { idx?: unknown } | null | undefined)?.idx;
  const currentIndex = typeof rawIndex === 'number' && Number.isFinite(rawIndex) ? rawIndex : 0;
  let maxIndex = currentIndex;

  try {
    const stored = Number(window.sessionStorage.getItem('__pa_nav_max_idx__') ?? currentIndex);
    if (Number.isFinite(stored)) {
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
}: {
  environment: DesktopEnvironmentState | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  showRailToggle: boolean;
  railOpen: boolean;
  onToggleRail: () => void;
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
  const showDesktopChrome = bridge !== null || environment !== null || isDesktopShell();

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

  return (
    <div className="ui-desktop-top-bar">
      <div className="ui-desktop-top-bar__drag-region" />
      <div className="ui-desktop-top-bar__leading">
        <div className="ui-desktop-top-bar__traffic-light-gap" aria-hidden="true" />
        <div className="ui-desktop-top-bar__controls" style={noDragStyle}>
          <ToolbarButton className="ui-desktop-top-bar__icon-button" onClick={() => { void handleBack(); }} disabled={!navigation.canGoBack} aria-label="Go back" title="Go back">
            ←
          </ToolbarButton>
          <ToolbarButton className="ui-desktop-top-bar__icon-button" onClick={() => { void handleForward(); }} disabled={!navigation.canGoForward} aria-label="Go forward" title="Go forward">
            →
          </ToolbarButton>
          <ToolbarButton
            className="ui-desktop-top-bar__icon-button"
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            <LeftSidebarToggleIcon open={sidebarOpen} />
          </ToolbarButton>
        </div>
      </div>
      <div className="ui-desktop-top-bar__center" />
      <div className="ui-desktop-top-bar__trailing" style={noDragStyle}>
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
        {bridge ? (
          <ToolbarButton className="ui-desktop-top-bar__action-button" onClick={() => { void bridge.showConnectionsWindow(); }}>
            Connections
          </ToolbarButton>
        ) : null}
      </div>
    </div>
  );
}
