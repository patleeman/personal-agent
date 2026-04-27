// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RelatedConversationSearchResult } from './relatedConversationSearch';
import { resolveRelatedThreadHotkeyIndex, useRelatedThreadHotkeys } from './useRelatedThreadHotkeys';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

function buildResult(sessionId: string): RelatedConversationSearchResult {
  return {
    sessionId,
    title: sessionId,
    cwd: '/repo',
    timestamp: '2026-04-27T12:00:00.000Z',
    snippet: '',
    matchedTerms: [],
    score: 10,
    sameWorkspace: true,
  };
}

const mountedRoots: Root[] = [];

describe('useRelatedThreadHotkeys', () => {
  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
  });

  it('resolves ctrl+digit hotkeys from keyboard code before key', () => {
    expect(resolveRelatedThreadHotkeyIndex({
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      key: 'Dead',
      code: 'Digit3',
      isComposing: false,
    })).toBe(2);
  });

  it('handles composer digit hotkeys before descendant handlers can mark them default-prevented', () => {
    const onToggle = vi.fn();

    function Harness() {
      useRelatedThreadHotkeys({
        enabled: true,
        results: [buildResult('conv-1'), buildResult('conv-2')],
        onToggle,
      });

      return <textarea aria-label="Composer" onKeyDown={(event) => event.preventDefault()} />;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    act(() => {
      root.render(<Harness />);
    });

    const composer = container.querySelector('textarea');
    expect(composer).not.toBeNull();

    act(() => {
      composer?.dispatchEvent(new KeyboardEvent('keydown', {
        key: '2',
        code: 'Digit2',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(onToggle).toHaveBeenCalledWith('conv-2');
  });
});
