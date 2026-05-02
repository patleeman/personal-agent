import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SelectionContextMenu, StreamingIndicator, WindowingBadge } from './ChatTranscriptChrome.js';

describe('ChatTranscriptChrome', () => {
  it('renders streaming status accessibly', () => {
    const html = renderToStaticMarkup(<StreamingIndicator label="Working…" />);

    expect(html).toContain('role="status"');
    expect(html).toContain('Working…');
  });

  it('renders compact windowing counts', () => {
    const html = renderToStaticMarkup(
      <WindowingBadge topOffset={-10} loadedMessageCount={12_000} mountedMessageCount={1_200} mountedChunkCount={2} totalChunkCount={9} />,
    );

    expect(html).toContain('top:0px');
    expect(html).toContain('12k loaded');
    expect(html).toContain('1.2k mounted');
    expect(html).toContain('2/9 chunks');
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
