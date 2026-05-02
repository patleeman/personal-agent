import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  BrowsePathButton,
  ChatBubbleIcon,
  ComposerActionIcon,
  FolderIcon,
  RemoteExecutionIcon,
  resolveConversationComposerShellStateClassName,
} from './ConversationComposerChrome';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('ConversationComposerChrome', () => {
  it('renders composer chrome icons and path button markup', () => {
    expect(renderToString(<FolderIcon className="folder" />)).toContain('folder');
    expect(renderToString(<ChatBubbleIcon className="chat" />)).toContain('chat');
    expect(renderToString(<RemoteExecutionIcon className="remote" />)).toContain('remote');
    expect(renderToString(<ComposerActionIcon label="Follow up" className="follow" />)).toContain('follow');
    expect(renderToString(<ComposerActionIcon label="Parallel" />)).toContain('M7 7h10');

    const browseHtml = renderToString(
      <BrowsePathButton busy title="Choose workspace folder" ariaLabel="Choose workspace folder" onClick={vi.fn()} />,
    );
    expect(browseHtml).toContain('Choose workspace folder');
    expect(browseHtml).toContain('disabled=""');
    expect(browseHtml).toContain('animate-pulse');
  });

  it('prioritizes composer shell state classes', () => {
    expect(
      resolveConversationComposerShellStateClassName({
        dragOver: true,
        hasInteractiveOverlay: true,
        autoModeEnabled: true,
      }),
    ).toContain('border-accent/50');

    expect(
      resolveConversationComposerShellStateClassName({
        dragOver: false,
        hasInteractiveOverlay: true,
        autoModeEnabled: true,
      }),
    ).toContain('border-accent/40');

    expect(
      resolveConversationComposerShellStateClassName({
        dragOver: false,
        hasInteractiveOverlay: false,
        autoModeEnabled: true,
      }),
    ).toContain('ui-input-shell-auto-mode');

    expect(
      resolveConversationComposerShellStateClassName({
        dragOver: false,
        hasInteractiveOverlay: false,
        autoModeEnabled: false,
      }),
    ).toBe('border-border-subtle');
  });
});
