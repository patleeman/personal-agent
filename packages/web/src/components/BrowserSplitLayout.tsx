import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { clampPanelWidth } from '../layoutSizing';
import { cx } from './ui';

interface ResizeOptions {
  initial: number;
  min: number;
  max: number;
  storageKey: string;
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

function useResize({ initial, min, max, storageKey }: ResizeOptions) {
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

      const delta = nextEvent.clientX - startX.current;
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
  }, [max, min, persistWidth, width]);

  useEffect(() => {
    setDesiredWidth(readStoredWidth(storageKey, initial, min));
  }, [storageKey, initial, min]);

  return { width, onMouseDown };
}

function ResizeHandle({ onMouseDown }: { onMouseDown: (event: ReactMouseEvent) => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="group relative z-10 w-[5px] flex-shrink-0 cursor-col-resize select-none"
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-hidden="true"
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

export function BrowserSplitLayout({
  storageKey,
  initialWidth,
  minWidth = 256,
  maxWidth = 420,
  browser,
  children,
  browserClassName,
  contentClassName,
  browserLabel = 'Browser',
}: {
  storageKey: string;
  initialWidth: number;
  minWidth?: number;
  maxWidth?: number;
  browser: ReactNode;
  children: ReactNode;
  browserClassName?: string;
  contentClassName?: string;
  browserLabel?: string;
}) {
  const browserPane = useResize({
    initial: initialWidth,
    min: minWidth,
    max: maxWidth,
    storageKey,
  });

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside
        style={{ width: browserPane.width }}
        className={cx('flex min-h-0 flex-shrink-0 flex-col overflow-hidden border-r border-border-subtle bg-surface/35', browserClassName)}
        aria-label={browserLabel}
      >
        {browser}
      </aside>
      <ResizeHandle onMouseDown={browserPane.onMouseDown} />
      <div className={cx('min-w-0 min-h-0 flex flex-1 flex-col overflow-hidden', contentClassName)}>{children}</div>
    </div>
  );
}
