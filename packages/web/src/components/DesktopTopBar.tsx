import { type CSSProperties, useEffect, useRef, useState } from 'react';
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

function LayoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1.5" y="2" width="11" height="10" rx="1.8" />
      <path d="M4.7 2v10" />
      <path d="M8.8 2v10" />
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
  const [navigation, setNavigation] = useState<DesktopNavigationState>({
    canGoBack: false,
    canGoForward: false,
  });
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const layoutMenuRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!layoutMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && layoutMenuRef.current?.contains(target)) {
        return;
      }
      setLayoutMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setLayoutMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [layoutMenuOpen]);

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
          <ToolbarButton
            className="ui-desktop-top-bar__icon-button"
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            <LeftSidebarToggleIcon open={sidebarOpen} />
          </ToolbarButton>
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
        <div ref={layoutMenuRef} className="relative">
          <ToolbarButton
            className="ui-desktop-top-bar__action-button"
            onClick={() => setLayoutMenuOpen((current) => !current)}
            aria-haspopup="menu"
            aria-expanded={layoutMenuOpen}
            aria-label="Choose layout"
            title="Choose layout"
          >
            <LayoutIcon />
            <span>{layoutMode === 'workbench' ? 'Workbench' : 'Compact'}</span>
            <span aria-hidden="true" className="text-dim">⌄</span>
          </ToolbarButton>
          {layoutMenuOpen ? (
            <div className="ui-desktop-layout-menu" role="menu" aria-label="Layout">
              <button
                type="button"
                className="ui-desktop-layout-menu__item"
                role="menuitemradio"
                aria-checked={layoutMode === 'compact'}
                onClick={() => {
                  onLayoutModeChange('compact');
                  setLayoutMenuOpen(false);
                }}
              >
                <span className="text-[13px] font-medium leading-4 text-primary">Compact</span>
                <span className="text-[10.5px] leading-3.5 text-secondary">One focused main pane.</span>
              </button>
              <button
                type="button"
                className="ui-desktop-layout-menu__item"
                role="menuitemradio"
                aria-checked={layoutMode === 'workbench'}
                onClick={() => {
                  onLayoutModeChange('workbench');
                  setLayoutMenuOpen(false);
                }}
              >
                <span className="text-[13px] font-medium leading-4 text-primary">Workbench</span>
                <span className="text-[10.5px] leading-3.5 text-secondary">Chat, note, and Knowledge.</span>
              </button>
            </div>
          ) : null}
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
