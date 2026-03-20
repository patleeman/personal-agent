import { Component, useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { CommandPalette } from './CommandPalette';
import { ContextRail } from './ContextRail';
import { Sidebar } from './Sidebar';
import { getConversationArtifactIdFromSearch } from '../conversationArtifacts';
import { clampPanelWidth, getArtifactRailTargetWidth, getRailInitialWidth, getRailLayoutPrefs, getRailMaxWidth } from '../layoutSizing';
import { SIDEBAR_WIDTH_STORAGE_KEY } from '../localSettings';

// ── Resize hook ───────────────────────────────────────────────────────────────

interface ResizeOptions {
  initial: number;
  min: number;
  max: number;
  storageKey: string;
  side: 'left' | 'right'; // which side of the handle the panel is on
}

function readStoredWidth(storageKey: string, initial: number, min: number): number {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (Number.isFinite(parsed)) {
        return Math.max(min, parsed);
      }
    }
  } catch { /* ignore */ }

  return Math.max(min, initial);
}

function useResize({ initial, min, max, storageKey, side }: ResizeOptions) {
  const [desiredWidth, setDesiredWidth] = useState(() => readStoredWidth(storageKey, initial, min));

  const dragging = useRef(false);
  const startX   = useRef(0);
  const startW   = useRef(0);
  const width = clampPanelWidth(desiredWidth, min, max);

  const persistWidth = useCallback((nextWidth: number) => {
    setDesiredWidth(nextWidth);
    try { localStorage.setItem(storageKey, String(nextWidth)); } catch { /* ignore */ }
  }, [storageKey]);

  const reset = useCallback(() => {
    persistWidth(Math.max(min, initial));
  }, [initial, min, persistWidth]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current   = e.clientX;
    startW.current   = width;
    document.body.style.cursor    = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const dx   = side === 'left' ? e.clientX - startX.current : startX.current - e.clientX;
      const next = clampPanelWidth(startW.current + dx, min, max);
      persistWidth(next);
    }

    function onUp() {
      dragging.current = false;
      document.body.style.cursor    = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }, [width, min, max, side, persistWidth]);

  useEffect(() => {
    setDesiredWidth(readStoredWidth(storageKey, initial, min));
  }, [storageKey, initial, min]);

  return { width, onMouseDown, reset };
}

// ── Resize handle ─────────────────────────────────────────────────────────────

function ResizeHandle({
  onMouseDown,
  onDoubleClick,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="relative flex-shrink-0 w-[5px] cursor-col-resize select-none z-10 group"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Wider invisible hit area */}
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      {/* Visual line — thickens on hover */}
      <div
        className="absolute inset-y-0 left-[2px] w-[1px] transition-all duration-100"
        style={{
          background: hovered
            ? 'rgb(var(--color-accent) / 0.5)'
            : 'rgb(var(--color-border-subtle))',
          width: hovered ? '2px' : '1px',
          left: hovered ? '1.5px' : '2px',
        }}
      />
    </div>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

class RouteContentBoundary extends Component<{
  resetKey: string;
  pathname: string;
  children: ReactNode;
}, {
  hasError: boolean;
}> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: Readonly<{ resetKey: string }>) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const isConversationRoute = this.props.pathname.startsWith('/conversations/');
    const title = isConversationRoute ? 'Conversation unavailable' : 'This page hit an unexpected error';
    const body = isConversationRoute
      ? 'This conversation may be stale, missing, or temporarily broken. Open another conversation or start a new one.'
      : 'Try another page, then come back if needed.';

    return (
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden select-text">
        <div className="flex h-full items-center justify-center px-8 py-10">
          <div className="max-w-lg rounded-2xl border border-border-subtle bg-surface px-6 py-6 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.18em] text-dim">Recovered from render error</p>
            <h1 className="mt-2 text-[22px] font-semibold text-primary">{title}</h1>
            <p className="mt-2 text-[13px] leading-6 text-secondary">{body}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/inbox" className="ui-action-button">Open inbox</Link>
              <Link to="/conversations/new" className="ui-action-button">New conversation</Link>
            </div>
          </div>
        </div>
      </main>
    );
  }
}

function useViewportWidth() {
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === 'undefined' ? 1440 : window.innerWidth
  ));

  useEffect(() => {
    function onResize() {
      setViewportWidth(window.innerWidth);
    }

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return viewportWidth;
}

export function Layout() {
  const location = useLocation();
  const viewportWidth = useViewportWidth();
  const sidebar = useResize({ initial: 224, min: 160, max: 320, storageKey: SIDEBAR_WIDTH_STORAGE_KEY, side: 'left'  });
  const railMinWidth = 160;
  const railMaxWidth = getRailMaxWidth({
    viewportWidth,
    sidebarWidth: sidebar.width,
    railMinWidth,
    mainMinWidth: 320,
  });
  const railPrefs = getRailLayoutPrefs(location.pathname);
  const railInitialWidth = getRailInitialWidth({
    pathname: location.pathname,
    viewportWidth,
    sidebarWidth: sidebar.width,
    railMinWidth,
    railMaxWidth,
  });
  const rail = useResize({
    initial: railInitialWidth,
    min: railMinWidth,
    max: railMaxWidth,
    storageKey: railPrefs.storageKey,
    side: 'right',
  });
  const isConversationArtifactOpen = location.pathname.startsWith('/conversations/')
    && getConversationArtifactIdFromSearch(location.search) !== null;
  const artifactRailTargetWidth = isConversationArtifactOpen
    ? clampPanelWidth(
        getArtifactRailTargetWidth({ viewportWidth, sidebarWidth: sidebar.width }),
        railMinWidth,
        railMaxWidth,
      )
    : null;
  const railWidth = artifactRailTargetWidth === null
    ? rail.width
    : Math.max(rail.width, artifactRailTargetWidth);

  return (
    <>
      <div className="flex h-screen overflow-hidden bg-base text-primary select-none">
        {/* Left sidebar */}
        <div style={{ width: sidebar.width }} className="flex-shrink-0 flex flex-col overflow-hidden bg-surface border-r border-border-subtle">
          <Sidebar />
        </div>

        <ResizeHandle onMouseDown={sidebar.onMouseDown} />

        <RouteContentBoundary resetKey={`${location.pathname}${location.search}`} pathname={location.pathname}>
          {/* Center */}
          <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden select-text">
            <Outlet />
          </main>

          <>
            <ResizeHandle onMouseDown={rail.onMouseDown} onDoubleClick={rail.reset} />
            <div style={{ width: railWidth }} className="flex-shrink-0 flex flex-col overflow-hidden select-text">
              <ContextRail />
            </div>
          </>
        </RouteContentBoundary>
      </div>

      <CommandPalette />
    </>
  );
}
