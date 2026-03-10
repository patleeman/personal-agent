import { useRef, useState, useCallback, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { ContextRail } from './ContextRail';
import { Sidebar } from './Sidebar';
import { ThemeSwitcher } from './ThemeSwitcher';

// ── Resize hook ───────────────────────────────────────────────────────────────

interface ResizeOptions {
  initial: number;
  min: number;
  max: number;
  storageKey: string;
  side: 'left' | 'right'; // which side of the handle the panel is on
}

function useResize({ initial, min, max, storageKey, side }: ResizeOptions) {
  const [width, setWidth] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const n = parseInt(stored, 10);
        if (n >= min && n <= max) return n;
      }
    } catch { /* ignore */ }
    return initial;
  });

  const dragging = useRef(false);
  const startX   = useRef(0);
  const startW   = useRef(0);

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
      const next = Math.max(min, Math.min(max, startW.current + dx));
      setWidth(next);
      try { localStorage.setItem(storageKey, String(next)); } catch { /* ignore */ }
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
  }, [width, min, max, side, storageKey]);

  return { width, onMouseDown };
}

// ── Resize handle ─────────────────────────────────────────────────────────────

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="relative flex-shrink-0 w-[5px] cursor-col-resize select-none z-10 group"
      onMouseDown={onMouseDown}
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

export function Layout() {
  const sidebar = useResize({ initial: 224, min: 160, max: 320, storageKey: 'pa:sidebar-width', side: 'left'  });
  const rail    = useResize({ initial: 380, min: 220, max: 560, storageKey: 'pa:rail-width',    side: 'right' });

  const [railCollapsed, setRailCollapsed] = useState(() => {
    try { return localStorage.getItem('pa:rail-collapsed') === 'true'; } catch { return false; }
  });

  function toggleRail() {
    setRailCollapsed(v => {
      const next = !v;
      try { localStorage.setItem('pa:rail-collapsed', String(next)); } catch { /* ignore */ }
      return next;
    });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-base text-primary select-none">
      {/* Left sidebar */}
      <div style={{ width: sidebar.width }} className="flex-shrink-0 flex flex-col overflow-hidden bg-surface border-r border-border-subtle">
        <Sidebar />
        {/* Theme toggle pinned to sidebar bottom */}
        <div className="px-3 py-2 border-t border-border-subtle flex justify-end">
          <ThemeSwitcher />
        </div>
      </div>

      <ResizeHandle onMouseDown={sidebar.onMouseDown} />

      {/* Center */}
      <main className="flex-1 min-w-0 overflow-y-auto select-text">
        <Outlet />
      </main>

      {railCollapsed ? (
        /* Collapsed strip — click to expand */
        <div className="flex-shrink-0 w-8 border-l border-border-subtle flex flex-col items-center pt-3 bg-surface">
          <button
            onClick={toggleRail}
            title="Show context panel"
            className="text-dim hover:text-secondary transition-colors p-1 rounded"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>
      ) : (
        <>
          <ResizeHandle onMouseDown={rail.onMouseDown} />
          <div style={{ width: rail.width }} className="flex-shrink-0 flex flex-col overflow-hidden">
            <ContextRail onCollapse={toggleRail} />
          </div>
        </>
      )}
    </div>
  );
}
