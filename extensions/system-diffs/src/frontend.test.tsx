import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const readCheckpointPresentationMock = vi.hoisted(() => vi.fn());

vi.mock('@personal-agent/extensions/data', () => ({
  timeAgo: () => 'just now',
}));

vi.mock('@personal-agent/extensions/ui', () => ({
  CheckpointInlineDiff: ({ checkpointId }: { checkpointId: string }) => <div>inline diff {checkpointId}</div>,
  SurfacePanel: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  cx: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
}));

vi.mock('@personal-agent/extensions/workbench', () => ({
  ConversationCheckpointWorkbenchPane: () => null,
  ConversationDiffRailContent: () => null,
  getConversationCheckpointIdFromSearch: () => null,
  setConversationCheckpointIdInSearch: () => '',
  useConversationCheckpointSummaries: () => ({ checkpoints: [], loading: false, error: null }),
}));

vi.mock('@personal-agent/extensions/workbench-diffs', () => ({
  readCheckpointPresentation: readCheckpointPresentationMock,
}));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

import { CheckpointTranscriptRenderer } from './frontend.js';

describe('CheckpointTranscriptRenderer', () => {
  it('renders an unsupported checkpoint tool block instead of disappearing', () => {
    readCheckpointPresentationMock.mockReturnValueOnce(null);

    const html = renderToStaticMarkup(
      <CheckpointTranscriptRenderer
        block={{ status: 'ok', input: { action: 'list' }, output: 'Commit checkpoints for conversation conv-1:' }}
        context={{}}
      />,
    );

    expect(html).toContain('Listed checkpoints');
    expect(html).toContain('Commit checkpoints for conversation conv-1:');
  });

  it('renders the checkpoint-specific card when presentation data is available', () => {
    readCheckpointPresentationMock.mockReturnValueOnce({
      action: 'save',
      conversationId: 'conv-1',
      checkpointId: 'abc1234',
      commitSha: 'abc123456789',
      shortSha: 'abc1234',
      title: 'fix: checkpoint cards',
      subject: 'fix: checkpoint cards',
    });

    const html = renderToStaticMarkup(<CheckpointTranscriptRenderer block={{ status: 'ok', input: { action: 'save' } }} context={{}} />);

    expect(html).toContain('fix: checkpoint cards');
    expect(html).toContain('inline diff abc1234');
  });
});
