/**
 * Wraps a context menu to keep it within the viewport.
 *
 * The trees library positions the context menu anchor at the right-click
 * coordinates with `position: fixed`. The menu content (rendered inside a
 * slot with `width: 0; overflow: visible`) uses `absolute left-0` which
 * extends right from the anchor — if the anchor is near the viewport edge,
 * the menu spills off-screen.
 *
 * This component measures the menu and flips it to the left when necessary.
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

interface ContextMenuWrapperProps {
  children: ReactNode;
  className?: string;
}

export function ContextMenuWrapper({ children, className }: ContextMenuWrapperProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Wait a tick for the DOM to settle and measure
    const raf = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const rightEdge = rect.left + rect.width;
      const viewportWidth = window.innerWidth;

      // If the menu extends past the viewport, flip it to the left
      if (rightEdge > viewportWidth) {
        setFlip(true);
      }
    });

    return () => cancelAnimationFrame(raf);
  }, []);

  const handleRef = useCallback((node: HTMLDivElement | null) => {
    (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    if (node) {
      // Re-measure when the DOM settles (the menu content may be async)
      requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        if (rect.left + rect.width > window.innerWidth) {
          setFlip(true);
        }
      });
    }
  }, []);

  return (
    <div ref={handleRef} className={className} style={flip ? { position: 'absolute', right: '0', left: 'auto', top: '0' } : undefined}>
      {children}
    </div>
  );
}
