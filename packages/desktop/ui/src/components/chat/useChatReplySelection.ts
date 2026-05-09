import { type MouseEvent as ReactMouseEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import { findSelectionReplyScopeElement, findSelectionReplyScopeElements, readSelectedTextWithinElement } from './replySelection.js';

interface ReplySelectionState {
  text: string;
  messageIndex: number;
  blockId?: string;
}

export interface ReplySelectionContextMenuState {
  x: number;
  y: number;
  text: string;
  replySelection: ReplySelectionState | null;
}

function clearWindowSelection() {
  if (typeof window === 'undefined') {
    return;
  }

  window.getSelection()?.removeAllRanges();
}

function readSafeGeometryNumber(value: number, fallback: number): number {
  return Number.isSafeInteger(value) ? value : fallback;
}

export function constrainSelectionContextMenuPosition(
  menuState: ReplySelectionContextMenuState,
  viewport: { width: number; height: number },
): ReplySelectionContextMenuState {
  const menuWidth = 224;
  const menuItemCount = 1 + Number(Boolean(menuState.replySelection));
  const menuHeight = menuItemCount * 33 + (menuItemCount > 1 ? 11 : 10);
  const edgePadding = 12;
  const viewportWidth = readSafeGeometryNumber(viewport.width, menuWidth + edgePadding * 2);
  const viewportHeight = readSafeGeometryNumber(viewport.height, menuHeight + edgePadding * 2);
  const x = readSafeGeometryNumber(menuState.x, edgePadding);
  const y = readSafeGeometryNumber(menuState.y, edgePadding);

  return {
    ...menuState,
    x: Math.max(edgePadding, Math.min(x, viewportWidth - menuWidth - edgePadding)),
    y: Math.max(edgePadding, Math.min(y, viewportHeight - menuHeight - edgePadding)),
  };
}

export function parseReplySelectionMessageIndex(value: string | undefined): number | null {
  const normalized = value?.trim() ?? '';
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function useChatReplySelection({
  onReplyToSelection,
  scrollContainerRef,
}: {
  onReplyToSelection?: (selection: { text: string; messageIndex: number; blockId?: string }) => Promise<void> | void;
  scrollContainerRef?: RefObject<HTMLDivElement>;
}) {
  const [replySelection, setReplySelection] = useState<ReplySelectionState | null>(null);
  const [selectionContextMenu, setSelectionContextMenu] = useState<ReplySelectionContextMenuState | null>(null);
  const replySelectionSyncFrameRef = useRef<number | null>(null);
  const replySelectionSyncTimeoutRefs = useRef<number[]>([]);
  const replySelectionClearTimeoutRef = useRef<number | null>(null);
  const selectionContextMenuRef = useRef<HTMLDivElement | null>(null);
  const lastReplySelectionScopeRef = useRef<HTMLElement | null>(null);

  const clearScheduledReplySelectionSync = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (replySelectionSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(replySelectionSyncFrameRef.current);
      replySelectionSyncFrameRef.current = null;
    }

    if (replySelectionSyncTimeoutRefs.current.length > 0) {
      for (const timeoutId of replySelectionSyncTimeoutRefs.current) {
        window.clearTimeout(timeoutId);
      }
      replySelectionSyncTimeoutRefs.current = [];
    }
  }, []);

  const cancelReplySelectionClear = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (replySelectionClearTimeoutRef.current !== null) {
      window.clearTimeout(replySelectionClearTimeoutRef.current);
      replySelectionClearTimeoutRef.current = null;
    }
  }, []);

  const closeSelectionContextMenu = useCallback(() => {
    setSelectionContextMenu((current) => (current ? null : current));
  }, []);

  const clearReplySelection = useCallback(() => {
    lastReplySelectionScopeRef.current = null;
    setReplySelection((current) => (current ? null : current));
  }, []);

  const scheduleReplySelectionClear = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      clearReplySelection();
      return;
    }

    if (document.visibilityState !== 'visible' || !document.hasFocus()) {
      return;
    }

    cancelReplySelectionClear();
    replySelectionClearTimeoutRef.current = window.setTimeout(() => {
      replySelectionClearTimeoutRef.current = null;
      clearReplySelection();
    }, 140);
  }, [cancelReplySelectionClear, clearReplySelection]);

  const resolveReplySelectionFromSelection = useCallback(
    (scopeHint?: HTMLElement | null): { scopeElement: HTMLElement; selection: ReplySelectionState } | null => {
      if (typeof window === 'undefined') {
        return null;
      }

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return null;
      }

      const range = selection.getRangeAt(0);
      const { startScope, endScope } = findSelectionReplyScopeElements(selection, range);
      const commonScope = findSelectionReplyScopeElement(range.commonAncestorContainer);
      const candidates = [scopeHint ?? null, startScope, endScope, commonScope, lastReplySelectionScopeRef.current]
        .filter((scope): scope is HTMLElement => Boolean(scope))
        .filter((scope, index, list) => list.indexOf(scope) === index);

      const matches = candidates.filter((scope) => readSelectedTextWithinElement(scope, range).length > 0);
      if (matches.length !== 1) {
        return null;
      }

      const scopeElement = matches[0];
      const text = readSelectedTextWithinElement(scopeElement, range);
      if (!text) {
        return null;
      }

      const messageIndex = parseReplySelectionMessageIndex(scopeElement.dataset.messageIndex);
      if (messageIndex === null) {
        return null;
      }

      return {
        scopeElement,
        selection: {
          text,
          messageIndex,
          blockId: scopeElement.dataset.blockId?.trim() || undefined,
        },
      };
    },
    [],
  );

  const applyResolvedReplySelection = useCallback(
    (resolvedSelection: { scopeElement: HTMLElement; selection: ReplySelectionState } | null) => {
      if (!resolvedSelection) {
        scheduleReplySelectionClear();
        return;
      }

      cancelReplySelectionClear();
      lastReplySelectionScopeRef.current = resolvedSelection.scopeElement;

      setReplySelection((current) => {
        if (
          current &&
          current.text === resolvedSelection.selection.text &&
          current.messageIndex === resolvedSelection.selection.messageIndex &&
          current.blockId === resolvedSelection.selection.blockId
        ) {
          return current;
        }

        return resolvedSelection.selection;
      });
    },
    [cancelReplySelectionClear, scheduleReplySelectionClear],
  );

  const syncReplySelectionFromSelection = useCallback(
    (scopeHint?: HTMLElement | null) => {
      applyResolvedReplySelection(resolveReplySelectionFromSelection(scopeHint));
    },
    [applyResolvedReplySelection, resolveReplySelectionFromSelection],
  );

  const scheduleReplySelectionSync = useCallback(
    (scopeElement?: HTMLElement | null) => {
      if (typeof window === 'undefined' || !onReplyToSelection) {
        clearScheduledReplySelectionSync();
        cancelReplySelectionClear();
        clearReplySelection();
        return;
      }

      const sync = () => {
        syncReplySelectionFromSelection(scopeElement);
      };

      clearScheduledReplySelectionSync();

      replySelectionSyncFrameRef.current = window.requestAnimationFrame(() => {
        replySelectionSyncFrameRef.current = null;
        sync();
      });

      for (const delayMs of [40, 120, 240, 480]) {
        const timeoutId = window.setTimeout(() => {
          replySelectionSyncTimeoutRefs.current = replySelectionSyncTimeoutRefs.current.filter((currentId) => currentId !== timeoutId);
          sync();
        }, delayMs);
        replySelectionSyncTimeoutRefs.current.push(timeoutId);
      }
    },
    [cancelReplySelectionClear, clearReplySelection, clearScheduledReplySelectionSync, onReplyToSelection, syncReplySelectionFromSelection],
  );

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined' || !onReplyToSelection) {
      clearScheduledReplySelectionSync();
      cancelReplySelectionClear();
      clearReplySelection();
      return;
    }

    const handleDocumentReplySelectionSync = () => {
      scheduleReplySelectionSync();
    };
    const handleFocus = () => {
      scheduleReplySelectionSync();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleReplySelectionSync();
      }
    };

    document.addEventListener('selectionchange', handleDocumentReplySelectionSync);
    document.addEventListener('mouseup', handleDocumentReplySelectionSync);
    document.addEventListener('pointerup', handleDocumentReplySelectionSync);
    document.addEventListener('keyup', handleDocumentReplySelectionSync);
    document.addEventListener('touchend', handleDocumentReplySelectionSync);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handleFocus);

    return () => {
      document.removeEventListener('selectionchange', handleDocumentReplySelectionSync);
      document.removeEventListener('mouseup', handleDocumentReplySelectionSync);
      document.removeEventListener('pointerup', handleDocumentReplySelectionSync);
      document.removeEventListener('keyup', handleDocumentReplySelectionSync);
      document.removeEventListener('touchend', handleDocumentReplySelectionSync);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handleFocus);
      clearScheduledReplySelectionSync();
      cancelReplySelectionClear();
    };
  }, [cancelReplySelectionClear, clearReplySelection, clearScheduledReplySelectionSync, onReplyToSelection, scheduleReplySelectionSync]);

  useEffect(() => {
    if (!replySelection || typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const element = target instanceof HTMLElement ? target : target.parentElement;
      if (
        element?.closest('[data-selection-context-menu="true"]') ||
        element?.closest('[data-selection-reply-scope="assistant-message"]')
      ) {
        return;
      }

      cancelReplySelectionClear();
      clearReplySelection();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      cancelReplySelectionClear();
      clearReplySelection();
      clearWindowSelection();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [cancelReplySelectionClear, clearReplySelection, replySelection]);

  useEffect(() => {
    if (!selectionContextMenu || typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const closeMenu = () => {
      closeSelectionContextMenu();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        closeMenu();
        return;
      }

      const element = target instanceof HTMLElement ? target : target.parentElement;
      if (element?.closest('[data-selection-context-menu="true"]')) {
        return;
      }

      closeMenu();
    };
    const handleSelectionChange = () => {
      const selectionText = window.getSelection()?.toString().trim() ?? '';
      if (!selectionText) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };
    const scrollEl = scrollContainerRef?.current;

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    scrollEl?.addEventListener('scroll', closeMenu, { passive: true });

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('resize', closeMenu);
      scrollEl?.removeEventListener('scroll', closeMenu);
    };
  }, [closeSelectionContextMenu, scrollContainerRef, selectionContextMenu]);

  const handleReplySelection = useCallback(
    async (selectionOverride?: ReplySelectionState | null) => {
      const activeSelection = selectionOverride ?? replySelection;
      if (!activeSelection || !onReplyToSelection) {
        return;
      }

      closeSelectionContextMenu();
      clearReplySelection();
      clearWindowSelection();
      await onReplyToSelection({
        text: activeSelection.text,
        messageIndex: activeSelection.messageIndex,
        blockId: activeSelection.blockId,
      });
    },
    [clearReplySelection, closeSelectionContextMenu, onReplyToSelection, replySelection],
  );

  const copySelectedTranscriptText = useCallback(
    async (text: string | null | undefined) => {
      const nextText = typeof text === 'string' ? text.trim() : '';

      closeSelectionContextMenu();
      if (!nextText || typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
        clearReplySelection();
        clearWindowSelection();
        return;
      }

      try {
        await navigator.clipboard.writeText(nextText);
      } finally {
        clearWindowSelection();
        clearReplySelection();
      }
    },
    [clearReplySelection, closeSelectionContextMenu],
  );

  const openDomSelectionContextMenu = useCallback((menuState: ReplySelectionContextMenuState) => {
    const viewportWidth = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerHeight;
    setSelectionContextMenu(constrainSelectionContextMenuPosition(menuState, { width: viewportWidth, height: viewportHeight }));
  }, []);

  const runSelectionContextMenuAction = useCallback(
    async (action: 'reply' | 'copy' | null, menuState?: ReplySelectionContextMenuState | null) => {
      const activeMenuState = menuState ?? selectionContextMenu;
      if (!action || !activeMenuState) {
        closeSelectionContextMenu();
        return;
      }

      switch (action) {
        case 'reply':
          await handleReplySelection(activeMenuState.replySelection);
          return;
        case 'copy':
          await copySelectedTranscriptText(activeMenuState.text);
          return;
      }
    },
    [closeSelectionContextMenu, copySelectedTranscriptText, handleReplySelection, selectionContextMenu],
  );

  const handleTranscriptContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (typeof window === 'undefined') {
        return;
      }

      const scopeHint = event.target instanceof Node ? findSelectionReplyScopeElement(event.target) : null;
      const resolvedReplySelection = onReplyToSelection ? resolveReplySelectionFromSelection(scopeHint) : null;
      if (onReplyToSelection) {
        applyResolvedReplySelection(resolvedReplySelection);
      }

      const selectionText = resolvedReplySelection?.selection.text ?? window.getSelection()?.toString().trim() ?? '';
      if (!selectionText) {
        closeSelectionContextMenu();
        return;
      }

      event.preventDefault();
      const menuState: ReplySelectionContextMenuState = {
        x: event.clientX,
        y: event.clientY,
        text: selectionText,
        replySelection: resolvedReplySelection?.selection ?? null,
      };
      openDomSelectionContextMenu(menuState);
    },
    [
      applyResolvedReplySelection,
      closeSelectionContextMenu,
      onReplyToSelection,
      openDomSelectionContextMenu,
      resolveReplySelectionFromSelection,
      runSelectionContextMenuAction,
    ],
  );

  return {
    replySelection,
    selectionContextMenu,
    selectionContextMenuRef,
    scheduleReplySelectionSync,
    runSelectionContextMenuAction,
    handleTranscriptContextMenu,
  };
}
