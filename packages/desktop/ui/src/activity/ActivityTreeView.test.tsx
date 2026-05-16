// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import type { ActivityTreeItem } from './activityTree';
import { ActivityTreeView } from './ActivityTreeView';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const items: ActivityTreeItem[] = [
  {
    id: 'conversation:test',
    kind: 'conversation',
    title: 'Test thread',
    status: 'idle',
    metadata: { conversationId: 'test' },
  },
];

function renderTree() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ActivityTreeView
        items={items}
        renderContextMenu={(item) => (
          <div role="menu" aria-label={`${item.title} actions`}>
            <button type="button" role="menuitem">
              Open
            </button>
          </div>
        )}
      />,
    );
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('ActivityTreeView', () => {
  it('closes the context menu when clicking outside the tree', () => {
    const { container, unmount } = renderTree();

    try {
      const row = container.querySelector<HTMLButtonElement>('[role="treeitem"]');
      expect(row).not.toBeNull();

      act(() => {
        row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 12 }));
      });
      expect(container.querySelector('[role="menu"]')).not.toBeNull();

      act(() => {
        document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      });
      expect(container.querySelector('[role="menu"]')).toBeNull();
    } finally {
      unmount();
    }
  });
});
