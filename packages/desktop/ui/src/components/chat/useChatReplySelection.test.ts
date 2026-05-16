// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import {
  constrainSelectionContextMenuPosition,
  parseReplySelectionMessageIndex,
  type ReplySelectionContextMenuState,
  useChatReplySelection,
} from './useChatReplySelection.js';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function menu(overrides: Partial<ReplySelectionContextMenuState> = {}): ReplySelectionContextMenuState {
  return {
    x: 100,
    y: 100,
    text: 'selected text',
    replySelection: null,
    ...overrides,
  };
}

function Harness() {
  const { selectionContextMenu, handleTranscriptContextMenu } = useChatReplySelection({ onReplyToSelection: vi.fn() });

  return React.createElement(
    'div',
    { onContextMenu: handleTranscriptContextMenu },
    React.createElement('p', { 'data-selection-reply-scope': 'assistant-message', 'data-message-index': '0' }, 'selected text'),
    selectionContextMenu
      ? React.createElement('div', { role: 'menu', 'data-selection-context-menu': 'true' }, selectionContextMenu.text)
      : null,
  );
}

function renderHarness() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Harness));
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function selectElementText(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('useChatReplySelection helpers', () => {
  it('keeps context menus within the viewport edge padding', () => {
    expect(constrainSelectionContextMenuPosition(menu({ x: 1, y: 2 }), { width: 500, height: 300 })).toMatchObject({ x: 12, y: 12 });
    expect(constrainSelectionContextMenuPosition(menu({ x: 490, y: 290 }), { width: 500, height: 300 })).toMatchObject({
      x: 264,
      y: 245,
    });
  });

  it('falls back when context menu geometry is malformed', () => {
    expect(
      constrainSelectionContextMenuPosition(menu({ x: Number.NaN, y: Number.POSITIVE_INFINITY }), { width: 500, height: 300 }),
    ).toMatchObject({ x: 12, y: 12 });
    expect(
      constrainSelectionContextMenuPosition(menu({ x: Number.MAX_SAFE_INTEGER + 1, y: 100 }), { width: 500, height: 300 }),
    ).toMatchObject({ x: 12, y: 100 });
    expect(constrainSelectionContextMenuPosition(menu({ x: 100.5, y: 120.5 }), { width: 500, height: 300 })).toMatchObject({
      x: 12,
      y: 12,
    });
  });

  it('accounts for the taller menu when a reply action is available', () => {
    expect(
      constrainSelectionContextMenuPosition(menu({ x: 490, y: 290, replySelection: { text: 'selected text', messageIndex: 3 } }), {
        width: 500,
        height: 300,
      }),
    ).toMatchObject({ x: 264, y: 211 });
  });

  it('rejects malformed reply selection message indexes', () => {
    expect(parseReplySelectionMessageIndex('12')).toBe(12);
    expect(parseReplySelectionMessageIndex('12abc')).toBeNull();
    expect(parseReplySelectionMessageIndex(String(Number.MAX_SAFE_INTEGER + 1))).toBeNull();
  });

  it('keeps the transcript context menu open when right-click selectionchange clears text immediately', () => {
    const { container, unmount } = renderHarness();

    try {
      const paragraph = container.querySelector<HTMLElement>('[data-selection-reply-scope="assistant-message"]');
      expect(paragraph).not.toBeNull();
      selectElementText(paragraph!);

      act(() => {
        paragraph?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
      });
      expect(container.querySelector('[role="menu"]')?.textContent).toBe('selected text');

      act(() => {
        window.getSelection()?.removeAllRanges();
        document.dispatchEvent(new Event('selectionchange'));
      });
      expect(container.querySelector('[role="menu"]')?.textContent).toBe('selected text');
    } finally {
      unmount();
      window.getSelection()?.removeAllRanges();
    }
  });
});
