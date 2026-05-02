import React from 'react';
import type { RefObject } from 'react';
import { formatWindowingCount } from './chatWindowing.js';
import type { ReplySelectionContextMenuState } from './useChatReplySelection.js';

void React;

export function StreamingIndicator({ label }: { label: string }) {
  return (
    <div className="flex gap-3 items-start" role="status" aria-live="polite">
      <div className="ui-chat-avatar mt-0.5">
        <span className="ui-chat-avatar-mark">pa</span>
      </div>
      <div className="flex items-center gap-2 pt-1 text-[12px] text-secondary italic">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent animate-pulse not-italic" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function WindowingBadge({
  topOffset,
  loadedMessageCount,
  mountedMessageCount,
  mountedChunkCount,
  totalChunkCount,
}: {
  topOffset: number;
  loadedMessageCount: number;
  mountedMessageCount: number;
  mountedChunkCount: number;
  totalChunkCount: number;
}) {
  return (
    <div
      className="sticky z-10 mb-3 flex justify-end pointer-events-none"
      style={{ top: `${Math.max(0, topOffset)}px` }}
    >
      <div className="inline-flex min-h-[2rem] items-center gap-2 rounded-lg border border-border-subtle bg-surface/88 px-3 py-1.5 text-[10px] text-secondary shadow-sm backdrop-blur">
        <span className="font-medium uppercase tracking-[0.16em] text-primary/85">windowing</span>
        <span>{formatWindowingCount(loadedMessageCount)} loaded</span>
        <span className="text-dim">·</span>
        <span>{formatWindowingCount(mountedMessageCount)} mounted</span>
        <span className="text-dim">·</span>
        <span>{mountedChunkCount}/{totalChunkCount} chunks</span>
      </div>
    </div>
  );
}

export function SelectionContextMenu({
  menuState,
  menuRef,
  onAction,
}: {
  menuState: ReplySelectionContextMenuState;
  menuRef: RefObject<HTMLDivElement>;
  onAction: (action: 'reply' | 'copy') => Promise<void> | void;
}) {
  const itemClassName = 'ui-context-menu-item';

  return (
    <div
      ref={menuRef}
      className="ui-menu-shell ui-context-menu-shell fixed bottom-auto left-auto right-auto top-auto mb-0 min-w-[224px]"
      style={{ left: menuState.x, top: menuState.y }}
      role="menu"
      aria-label="Selected transcript text actions"
      data-selection-context-menu="true"
    >
      <div className="space-y-px">
        {menuState.replySelection ? (
          <>
            <button
              type="button"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={() => { void onAction('reply'); }}
              className={itemClassName}
              role="menuitem"
            >
              Reply with Selection
            </button>
            <div className="mx-1 my-1 h-px bg-border-subtle" role="separator" />
          </>
        ) : null}
        <button
          type="button"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={() => { void onAction('copy'); }}
          className={itemClassName}
          role="menuitem"
        >
          Copy
        </button>
      </div>
    </div>
  );
}
