import { type CSSProperties, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getDesktopBridge, isDesktopShell } from '../desktopBridge';
import type { DesktopEnvironmentState, DesktopNavigationState } from '../types';
import { ToolbarButton } from './ui';

function formatHostLabel(environment: DesktopEnvironmentState | null, hasDesktopBridge: boolean): string {
  if (!environment) {
    return hasDesktopBridge ? 'Desktop app' : 'Web app';
  }

  if (environment.activeHostKind === 'local') {
    return environment.activeHostLabel;
  }

  return `${environment.activeHostLabel} · ${environment.activeHostKind === 'web' ? 'Web' : 'SSH'}`;
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
}: {
  environment: DesktopEnvironmentState | null;
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
          <ToolbarButton className="ui-desktop-top-bar__nav-button" onClick={() => { void handleBack(); }} disabled={!navigation.canGoBack} aria-label="Go back">
            ←
          </ToolbarButton>
          <ToolbarButton className="ui-desktop-top-bar__nav-button" onClick={() => { void handleForward(); }} disabled={!navigation.canGoForward} aria-label="Go forward">
            →
          </ToolbarButton>
        </div>
      </div>
      <div className="ui-desktop-top-bar__center">
        <span className="ui-desktop-top-bar__title">Personal Agent</span>
        <span className="ui-desktop-top-bar__separator" aria-hidden="true">—</span>
        <span className="ui-desktop-top-bar__meta">{formatHostLabel(environment, Boolean(bridge))}</span>
      </div>
      <div className="ui-desktop-top-bar__trailing" style={noDragStyle}>
        {bridge ? (
          <ToolbarButton className="ui-desktop-top-bar__action-button" onClick={() => { void bridge.showConnectionsWindow(); }}>
            Connections
          </ToolbarButton>
        ) : null}
      </div>
    </div>
  );
}
