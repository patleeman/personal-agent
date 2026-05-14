// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MessageBlock } from '../../shared/types';

vi.mock('../../extensions/useExtensionRegistry', () => ({
  useExtensionRegistry: () => ({
    extensions: [
      {
        id: 'system-conversation-tools',
        enabled: true,
        manifest: {
          contributes: {
            transcriptRenderers: [
              {
                id: 'terminal-bash-tool-block',
                tool: 'bash',
                component: 'TerminalBashTranscriptRenderer',
              },
            ],
          },
        },
      },
    ],
    routes: [],
    surfaces: [],
    topBarElements: [],
    messageActions: [],
    composerShelves: [],
    newConversationPanels: [],
    settingsComponent: null,
    settingsComponents: [],
    composerButtons: [],
    composerInputTools: [],
    toolbarActions: [],
    contextMenus: [],
    threadHeaderActions: [],
    statusBarItems: [],
    conversationHeaderElements: [],
    conversationDecorators: [],
    activityTreeItemElements: [],
    activityTreeItemStyles: [],
    loading: false,
    error: null,
  }),
}));

vi.mock('../../extensions/NativeExtensionToolBlockHost', () => ({
  NativeExtensionToolBlockHost: ({ block }: { block: { tool: string } }) => (
    <div data-extension-tool-host="true">{block.tool} transcript card</div>
  ),
}));

import { ChatView } from './ChatView.js';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];

function renderChatView(messages: MessageBlock[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ChatView messages={messages} isStreaming={false} />);
  });

  mountedRoots.push(root);
  return { container, root };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of mountedRoots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.innerHTML = '';
});

describe('ChatView bash trace clusters', () => {
  it('does not mount collapsed trace blocks until the cluster is expanded', () => {
    const bashBlock = {
      id: 'tool-1',
      type: 'tool_use',
      ts: '2026-05-13T10:56:49.000Z',
      tool: 'bash',
      input: { command: 'pwd' },
      output: '/Users/patrick/workingdir/personal-agent',
      status: 'ok',
    } satisfies Extract<MessageBlock, { type: 'tool_use' }>;

    const { container } = renderChatView([bashBlock]);

    expect(container.textContent).toContain('Internal work');
    expect(container.textContent).not.toContain('pwd');
    expect(container.querySelector('[data-extension-tool-host="true"]')).toBeNull();
  });

  it('shows the generic bash tool card when an internal-work cluster is expanded', () => {
    const bashBlock = {
      id: 'tool-1',
      type: 'tool_use',
      ts: '2026-05-13T10:56:49.000Z',
      tool: 'bash',
      input: { command: 'pwd' },
      output: '/Users/patrick/workingdir/personal-agent',
      status: 'ok',
    } satisfies Extract<MessageBlock, { type: 'tool_use' }>;

    const { container } = renderChatView([bashBlock]);

    expect(container.textContent).toContain('Internal work');
    expect(container.textContent).not.toContain('pwd');

    const toggle = container.querySelector('button[aria-expanded]');
    expect(toggle).not.toBeNull();

    act(() => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('pwd');
    expect(container.querySelector('[data-extension-tool-host="true"]')).toBeNull();
  });
});
