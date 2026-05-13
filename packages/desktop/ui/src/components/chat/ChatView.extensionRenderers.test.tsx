import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../extensions/useExtensionRegistry', () => ({
  useExtensionRegistry: () => ({
    extensions: [
      {
        id: 'system-artifacts',
        enabled: true,
        manifest: {
          contributes: {
            transcriptRenderers: [
              {
                id: 'artifact-tool-block',
                tool: 'artifact',
                component: 'ArtifactTranscriptRenderer',
                standalone: true,
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

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('chat view extension transcript renderers', () => {
  it('renders standalone artifact transcript cards outside internal-work clusters', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-05-12T18:00:00.000Z',
            tool: 'artifact',
            input: {
              action: 'save',
              artifactId: 'artifact-test',
              title: 'Artifact Test',
              kind: 'html',
            },
            details: {
              action: 'save',
              artifactId: 'artifact-test',
              title: 'Artifact Test',
              kind: 'html',
            },
            output: 'Saved artifact',
            status: 'ok',
          },
        ],
      }),
    );

    expect(html).toContain('artifact transcript card');
    expect(html).not.toContain('Internal work');
  });
});
