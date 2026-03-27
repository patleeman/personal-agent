import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { getConversationArtifactIdFromSearch } from '../conversationArtifacts';
import { clampPanelWidth, getRailLayoutPrefs } from '../layoutSizing';
import { ContextRail } from './ContextRail';

const CONVERSATION_WORKSPACE_RAIL_MIN_WIDTH = 280;
const CONVERSATION_WORKSPACE_RAIL_MAX_WIDTH = 520;
const CONVERSATION_ARTIFACT_RAIL_TARGET_WIDTH = 460;

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
      className="group relative z-10 w-[5px] flex-shrink-0 cursor-col-resize select-none"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      <div
        className="absolute inset-y-0 left-[2px] transition-all duration-100"
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

export function ConversationWorkspaceShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const railPrefs = getRailLayoutPrefs(location.pathname);
  const rail = useResize({
    initial: railPrefs.initialWidth ?? 380,
    min: CONVERSATION_WORKSPACE_RAIL_MIN_WIDTH,
    max: CONVERSATION_WORKSPACE_RAIL_MAX_WIDTH,
    storageKey: railPrefs.storageKey,
    side: 'right',
  });
  const selectedArtifactId = getConversationArtifactIdFromSearch(location.search);
  const railWidth = selectedArtifactId
    ? clampPanelWidth(
        Math.max(rail.width, CONVERSATION_ARTIFACT_RAIL_TARGET_WIDTH),
        CONVERSATION_WORKSPACE_RAIL_MIN_WIDTH,
        CONVERSATION_WORKSPACE_RAIL_MAX_WIDTH,
      )
    : rail.width;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="min-w-0 flex-1">{children}</div>
      <ResizeHandle onMouseDown={rail.onMouseDown} onDoubleClick={rail.reset} />
      <aside
        style={{ width: railWidth }}
        className="min-h-0 flex-shrink-0 overflow-hidden border-l border-border-subtle bg-surface/35"
        aria-label="Conversation context"
      >
        <ContextRail />
      </aside>
    </div>
  );
}
