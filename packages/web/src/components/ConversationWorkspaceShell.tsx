import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { getConversationRunIdFromSearch } from '../conversation/conversationRuns';
import { clampPanelWidth, getRailLayoutPrefs } from '../ui-state/layoutSizing';
import { useDesktopChrome } from '../desktop/desktopChromeContext';
import { ContextRail } from './ContextRail';

const CONVERSATION_WORKSPACE_RAIL_MIN_WIDTH = 280;
const CONVERSATION_WORKSPACE_RAIL_MAX_WIDTH = 520;

export interface ConversationWorkspaceShellControls {
  railOpen: boolean;
  toggleRail: () => void;
}

interface ResizeOptions {
  initial: number;
  min: number;
  max: number;
  storageKey: string;
  side: 'left' | 'right';
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
  } catch {
    // Ignore storage failures.
  }

  return Math.max(min, initial);
}

function useResize({ initial, min, max, storageKey, side }: ResizeOptions) {
  const [desiredWidth, setDesiredWidth] = useState(() => readStoredWidth(storageKey, initial, min));

  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const width = clampPanelWidth(desiredWidth, min, max);

  const persistWidth = useCallback((nextWidth: number) => {
    setDesiredWidth(nextWidth);
    try {
      localStorage.setItem(storageKey, String(nextWidth));
    } catch {
      // Ignore storage failures.
    }
  }, [storageKey]);

  const reset = useCallback(() => {
    persistWidth(Math.max(min, initial));
  }, [initial, min, persistWidth]);

  const onMouseDown = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    dragging.current = true;
    startX.current = event.clientX;
    startW.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(nextEvent: MouseEvent) {
      if (!dragging.current) {
        return;
      }

      const delta = side === 'left'
        ? nextEvent.clientX - startX.current
        : startX.current - nextEvent.clientX;
      persistWidth(clampPanelWidth(startW.current + delta, min, max));
    }

    function onUp() {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [max, min, persistWidth, side, width]);

  useEffect(() => {
    setDesiredWidth(readStoredWidth(storageKey, initial, min));
  }, [storageKey, initial, min]);

  return { width, onMouseDown, reset };
}

function ResizeHandle({
  onMouseDown,
  onDoubleClick,
}: {
  onMouseDown: (event: ReactMouseEvent) => void;
  onDoubleClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="group relative z-10 w-4 flex-shrink-0 cursor-col-resize select-none"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="absolute inset-y-0 left-0 right-0" />
      <div
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-full transition-all duration-100"
        style={{
          background: hovered
            ? 'rgb(var(--color-accent) / 0.45)'
            : 'rgb(var(--color-border-subtle) / 0.45)',
          width: hovered ? '2px' : '1px',
        }}
      />
    </div>
  );
}

export function ConversationWorkspaceShell({
  children,
  contextRailEnabled = true,
}: {
  children: ReactNode | ((controls: ConversationWorkspaceShellControls) => ReactNode);
  contextRailEnabled?: boolean;
}) {
  const location = useLocation();
  const { setRightRailControl } = useDesktopChrome();
  const railPrefs = getRailLayoutPrefs(location.pathname);
  const rail = useResize({
    initial: railPrefs.initialWidth ?? 380,
    min: CONVERSATION_WORKSPACE_RAIL_MIN_WIDTH,
    max: CONVERSATION_WORKSPACE_RAIL_MAX_WIDTH,
    storageKey: railPrefs.storageKey,
    side: 'right',
  });
  const hasSelectedRun = contextRailEnabled && getConversationRunIdFromSearch(location.search) !== null;
  const [railOpen, setRailOpen] = useState(() => hasSelectedRun);

  const previousPathnameRef = useRef(location.pathname);

  useEffect(() => {
    if (previousPathnameRef.current === location.pathname) {
      return;
    }

    previousPathnameRef.current = location.pathname;
    setRailOpen(hasSelectedRun);
  }, [hasSelectedRun, location.pathname]);

  useEffect(() => {
    if (hasSelectedRun) {
      setRailOpen(true);
    }
  }, [hasSelectedRun]);

  const toggleRail = useCallback(() => {
    if (contextRailEnabled) {
      setRailOpen((current) => !current);
    }
  }, [contextRailEnabled]);

  const effectiveRailOpen = contextRailEnabled && railOpen;
  const controls = useMemo<ConversationWorkspaceShellControls>(() => ({
    railOpen: effectiveRailOpen,
    toggleRail,
  }), [effectiveRailOpen, toggleRail]);

  useEffect(() => {
    if (!contextRailEnabled) {
      setRightRailControl(null);
      return;
    }

    setRightRailControl({
      railOpen: effectiveRailOpen,
      toggleRail,
    });

    return () => {
      setRightRailControl(null);
    };
  }, [contextRailEnabled, effectiveRailOpen, setRightRailControl, toggleRail]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="min-w-0 flex-1">{typeof children === 'function' ? children(controls) : children}</div>
      {effectiveRailOpen ? <ResizeHandle onMouseDown={rail.onMouseDown} onDoubleClick={rail.reset} /> : null}
      {effectiveRailOpen ? (
        <aside
          style={{ width: rail.width }}
          className="min-h-0 flex-shrink-0 overflow-hidden bg-transparent"
          aria-label="Conversation context"
        >
          <ContextRail />
        </aside>
      ) : null}
    </div>
  );
}
