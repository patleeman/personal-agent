import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

import type { VaultEntry } from '../../shared/types';

// ── List component ────────────────────────────────────────────────────────────

interface WikiLinkListProps {
  items: VaultEntry[];
  command: (item: VaultEntry) => void;
}

interface WikiLinkListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

function Ico({ d, size = 12 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={d} />
    </svg>
  );
}

const FILE_ICON =
  'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z';

const WikiLinkList = forwardRef<WikiLinkListRef, WikiLinkListProps>(function WikiLinkList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => setSelectedIndex(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown({ event }: SuggestionKeyDownProps) {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter') {
        const item = items[selectedIndex];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  if (!items.length) {
    return (
      <div className="kb-wikilink-popup">
        <p className="px-3 py-2 text-[12px] text-dim">No matching files</p>
      </div>
    );
  }

  return (
    <div className="kb-wikilink-popup">
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          className={[
            'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] truncate',
            i === selectedIndex ? 'bg-accent/15 text-primary' : 'text-secondary hover:bg-accent/8 hover:text-primary',
          ].join(' ')}
          onMouseDown={(e) => {
            e.preventDefault();
            command(item);
          }}
        >
          <span className="text-dim shrink-0">
            <Ico d={FILE_ICON} />
          </span>
          <span className="truncate">{item.name.replace(/\.md$/, '')}</span>
          <span className="text-dim truncate text-[10px] ml-auto">{item.id.split('/').slice(0, -1).join('/')}</span>
        </button>
      ))}
    </div>
  );
});

// ── Renderer factory ──────────────────────────────────────────────────────────
// Returns the render object expected by @tiptap/suggestion.
// We render the list into a fixed-position div portal (no tippy dependency).

export function buildWikiLinkRenderer() {
  let container: HTMLDivElement | null = null;
  let reactRoot: import('react-dom/client').Root | null = null;
  let listRef: WikiLinkListRef | null = null;

  function mount(props: SuggestionProps<VaultEntry>) {
    const { clientRect } = props;
    if (!clientRect) return;

    container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.zIndex = '9999';
    document.body.appendChild(container);

    position(clientRect);

    import('react-dom/client').then(({ createRoot }) => {
      import('react').then(({ createElement, createRef }) => {
        const ref = createRef<WikiLinkListRef>();
        reactRoot = createRoot(container!);
        reactRoot.render(
          createElement(WikiLinkList, {
            ref,
            items: props.items,
            command: props.command,
          }),
        );
        // Give react a tick to mount
        setTimeout(() => {
          listRef = ref.current;
        }, 0);
      });
    });
  }

  function position(clientRect: (() => DOMRect | null) | null) {
    if (!container || !clientRect) return;
    const rect = typeof clientRect === 'function' ? clientRect() : clientRect;
    if (!rect) return;
    const POPUP_HEIGHT = 220;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= POPUP_HEIGHT ? rect.bottom + 4 : rect.top - POPUP_HEIGHT - 4;
    container.style.left = `${rect.left}px`;
    container.style.top = `${top}px`;
  }

  function update(props: SuggestionProps<VaultEntry>) {
    if (!reactRoot) return;
    position(props.clientRect ?? null);
    import('react').then(({ createElement, createRef }) => {
      const ref = createRef<WikiLinkListRef>();
      reactRoot!.render(
        createElement(WikiLinkList, {
          ref,
          items: props.items,
          command: props.command,
        }),
      );
      setTimeout(() => {
        listRef = ref.current;
      }, 0);
    });
  }

  function destroy() {
    if (reactRoot) {
      reactRoot.unmount();
      reactRoot = null;
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
    listRef = null;
  }

  return () => ({
    onStart: mount,
    onUpdate: update,
    onExit: destroy,
    onKeyDown: (props: SuggestionKeyDownProps) => listRef?.onKeyDown(props) ?? false,
  });
}
