import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ConversationComposerMeta } from './ConversationComposerMeta';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const baseProps: React.ComponentProps<typeof ConversationComposerMeta> = {
  showExecutionTargetPicker: true,
  selectedExecutionTargetId: 'local',
  executionTargetOptions: [{ value: 'local', label: 'Local' }],
  continueInBusy: false,
  onSelectExecutionTarget: vi.fn(),
  remoteOperationInlineStatus: null,
  remoteOperationStatusKind: null,
  draft: true,
  hasDraftCwd: false,
  selectedExecutionTargetIsRemote: false,
  selectedExecutionTargetLabel: 'Local',
  draftCwdValue: '',
  draftCwdError: null,
  draftCwdPickBusy: false,
  availableDraftWorkspacePaths: ['/repo'],
  onDraftRemoteCwdChange: vi.fn(),
  onClearDraftCwdSelection: vi.fn(),
  onSelectDraftWorkspace: vi.fn(),
  onPickDraftCwd: vi.fn(),
  conversationCwdEditorOpen: false,
  currentCwd: null,
  currentCwdLabel: '',
  conversationCwdDraft: '',
  conversationCwdError: null,
  conversationCwdBusy: false,
  conversationCwdPickBusy: false,
  onConversationCwdDraftChange: vi.fn(),
  onSubmitConversationCwdChange: vi.fn(),
  onCancelConversationCwdEdit: vi.fn(),
  onPickConversationCwd: vi.fn(),
  onBeginConversationCwdEdit: vi.fn(),
  branchLabel: null,
  gitSummaryPresentation: { kind: 'none' },
  sessionTokens: null,
};

describe('ConversationComposerMeta', () => {
  it('renders draft local workspace controls', () => {
    const html = renderToString(<ConversationComposerMeta {...baseProps} />);

    expect(html).toContain('Workspace folder');
    expect(html).toContain('/repo');
    expect(html).toContain('Choose folder');
    expect(html).toContain('Conversation options');
  });

  it('renders draft remote workspace controls', () => {
    const html = renderToString(
      <ConversationComposerMeta
        {...baseProps}
        selectedExecutionTargetIsRemote
        selectedExecutionTargetLabel="Remote"
        draftCwdValue="~/repo"
        draftCwdError="bad path"
      />,
    );

    expect(html).toContain('Remote workspace path');
    expect(html).toContain('~/repo');
    expect(html).toContain('Choose directory on Remote');
    expect(html).toContain('bad path');
  });

  it('renders saved conversation cwd metadata', () => {
    const html = renderToString(
      <ConversationComposerMeta
        {...baseProps}
        draft={false}
        showExecutionTargetPicker={false}
        currentCwd="/repo/project"
        currentCwdLabel="project"
        branchLabel="main"
        gitSummaryPresentation={{ kind: 'diff', added: '+12', deleted: '-3' }}
        sessionTokens={{ total: 50000, contextWindow: 100000 }}
      />,
    );

    expect(html).toContain('Working directory: /repo/project');
    expect(html).toContain('project');
    expect(html).toContain('Conversation options');
  });
});
