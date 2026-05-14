import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SelectionContextMenu, StreamingIndicator } from './ChatTranscriptChrome.js';

describe('ChatTranscriptChrome', () => {
  it('renders streaming status accessibly', () => {
    const html = renderToStaticMarkup(<StreamingIndicator label="Working…" />);

    expect(html).toContain('role="status"');
    expect(html).toContain('Working…');
  });

  it('renders reply and copy actions when reply selection is available', () => {
    const onAction = vi.fn();
    const html = renderToStaticMarkup(
      <SelectionContextMenu
        menuState={{ x: 10, y: 20, text: 'selected', replySelection: { text: 'selected', messageIndex: 1 } }}
        menuRef={{ current: null }}
        onAction={onAction}
      />,
    );

    expect(html).toContain('Reply with Selection');
    expect(html).toContain('Copy');
  });
});
