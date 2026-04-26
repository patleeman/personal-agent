import type { SyntheticEvent } from 'react';
import { normalizeReplyQuoteSelection } from '../../conversation/conversationReplyQuote';

export type ReplySelectionGestureHandler = (scopeElement: HTMLElement) => void;

export function getElementFromNode(node: Node | null): HTMLElement | null {
  if (!node) {
    return null;
  }

  if (node instanceof HTMLElement) {
    return node;
  }

  return node.parentElement;
}

export function findSelectionReplyScopeElement(node: Node | null): HTMLElement | null {
  return getElementFromNode(node)?.closest('[data-selection-reply-scope="assistant-message"]') ?? null;
}

export function findSelectionReplyScopeElements(selection: Selection, range: Range): { startScope: HTMLElement | null; endScope: HTMLElement | null } {
  const anchorScope = findSelectionReplyScopeElement(selection.anchorNode);
  const focusScope = findSelectionReplyScopeElement(selection.focusNode);

  return {
    startScope: anchorScope ?? findSelectionReplyScopeElement(range.startContainer),
    endScope: focusScope ?? findSelectionReplyScopeElement(range.endContainer),
  };
}

export function readSelectedTextWithinElement(element: HTMLElement | null, selectionRange?: Range | null): string {
  if (!element || typeof window === 'undefined' || typeof document === 'undefined') {
    return '';
  }

  const range = selectionRange ?? (() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    return selection.getRangeAt(0);
  })();

  if (!range) {
    return '';
  }

  const scopeRange = document.createRange();
  scopeRange.selectNodeContents(element);

  if (
    range.compareBoundaryPoints(Range.START_TO_END, scopeRange) <= 0
    || range.compareBoundaryPoints(Range.END_TO_START, scopeRange) >= 0
  ) {
    return '';
  }

  const intersection = document.createRange();

  if (range.compareBoundaryPoints(Range.START_TO_START, scopeRange) <= 0) {
    intersection.setStart(scopeRange.startContainer, scopeRange.startOffset);
  } else {
    intersection.setStart(range.startContainer, range.startOffset);
  }

  if (range.compareBoundaryPoints(Range.END_TO_END, scopeRange) >= 0) {
    intersection.setEnd(scopeRange.endContainer, scopeRange.endOffset);
  } else {
    intersection.setEnd(range.endContainer, range.endOffset);
  }

  return normalizeReplyQuoteSelection(intersection.toString());
}

export function buildReplySelectionScopeProps(messageIndex?: number, blockId?: string, onSelectionGesture?: ReplySelectionGestureHandler) {
  const handleSelectionGesture = onSelectionGesture
    ? (event: SyntheticEvent<HTMLElement>) => {
        onSelectionGesture(event.currentTarget);
      }
    : undefined;

  return {
    'data-selection-reply-scope': 'assistant-message',
    'data-message-index': typeof messageIndex === 'number' ? String(messageIndex) : undefined,
    'data-block-id': blockId,
    onMouseUp: handleSelectionGesture,
    onPointerUp: handleSelectionGesture,
    onKeyUp: handleSelectionGesture,
    onTouchEnd: handleSelectionGesture,
  };
}
