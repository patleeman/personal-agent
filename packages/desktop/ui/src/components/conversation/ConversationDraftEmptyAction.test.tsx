import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConversationDraftEmptyAction } from './ConversationDraftEmptyAction';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const baseProps: React.ComponentProps<typeof ConversationDraftEmptyAction> = {
  hasDraftCwd: false,
  selectedExecutionTargetIsRemote: false,
  selectedExecutionTargetLabel: 'Local',
  draftCwdValue: '',
  draftCwdError: null,
  draftCwdPickBusy: false,
  savedWorkspacePathsLoading: false,
  availableDraftWorkspacePaths: ['/repo'],
  relatedThreadQuery: '',
  relatedThreadResults: [],
  selectedRelatedThreadIds: [],
  autoSelectedRelatedThreadIds: [],
  relatedThreadSearchLoading: false,
  preparingRelatedThreadContext: false,
  relatedThreadSearchError: null,
  maxRelatedThreadSelections: 3,
  relatedThreadHotkeyLimit: 5,
  onDraftRemoteCwdChange: vi.fn(),
  onClearDraftCwdSelection: vi.fn(),
  onSelectDraftWorkspace: vi.fn(),
  onPickDraftCwd: vi.fn(),
  onToggleRelatedThread: vi.fn(),
};

function renderAction(overrides: Partial<React.ComponentProps<typeof ConversationDraftEmptyAction>> = {}) {
  return renderToString(
    <MemoryRouter>
      <ConversationDraftEmptyAction {...baseProps} {...overrides} />
    </MemoryRouter>,
  );
}

describe('ConversationDraftEmptyAction', () => {
  it('renders local chat/workspace selection', () => {
    const html = renderAction();

    expect(html).toContain('Chat');
    expect(html).toContain('Saved workspace');
    expect(html).toContain('Chat — no workspace');
    expect(html).toContain('/repo');
    expect(html).toContain('Choose workspace folder');
  });

  it('renders remote workspace path selection', () => {
    const html = renderAction({
      selectedExecutionTargetIsRemote: true,
      selectedExecutionTargetLabel: 'Remote Host',
      draftCwdValue: '~/repo',
      draftCwdError: 'bad path',
    });

    expect(html).toContain('Remote workspace path');
    expect(html).toContain('~/repo');
    expect(html).toContain('Choose directory on Remote Host');
    expect(html).toContain('Remote path on');
    expect(html).toContain('Remote Host');
    expect(html).toContain('bad path');
  });

  it('renders related thread panel state', () => {
    const html = renderAction({
      relatedThreadQuery: 'architecture',
      relatedThreadResults: [{
        sessionId: 'conv-1',
        title: 'Architecture pass',
        cwd: '/repo',
        timestamp: '2026-04-01T00:00:00.000Z',
        snippet: 'Split the page',
        matchedTerms: ['architecture'],
        score: 10,
        sameWorkspace: true,
      }],
      selectedRelatedThreadIds: ['conv-1'],
    });

    expect(html).toContain('Suggested context');
    expect(html).toContain('Architecture pass');
    expect(html).toContain('Split the page');
  });
});
