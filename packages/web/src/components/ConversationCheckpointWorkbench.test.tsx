import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConversationCheckpointWorkbenchPane, ConversationDiffRailContent } from './ConversationCheckpointWorkbench.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('ConversationCheckpointWorkbench', () => {
  it('renders conversation diffs newest-first in the rail', () => {
    const html = renderToString(
      <ConversationDiffRailContent
        checkpoints={[
          {
            id: 'newer',
            conversationId: 'conv-1',
            title: 'Newer change',
            cwd: '/tmp/repo',
            commitSha: 'def4567890',
            shortSha: 'def4567',
            subject: 'Newer change summary',
            authorName: 'Patrick Lee',
            committedAt: '2026-04-30T12:00:00.000Z',
            createdAt: '2026-04-30T12:00:00.000Z',
            updatedAt: '2026-04-30T12:00:00.000Z',
            fileCount: 2,
            linesAdded: 10,
            linesDeleted: 3,
            commentCount: 0,
          },
          {
            id: 'older',
            conversationId: 'conv-1',
            title: 'Older change',
            cwd: '/tmp/repo',
            commitSha: 'abc1234567',
            shortSha: 'abc1234',
            subject: 'Older change summary',
            authorName: 'Patrick Lee',
            committedAt: '2026-04-30T11:00:00.000Z',
            createdAt: '2026-04-30T11:00:00.000Z',
            updatedAt: '2026-04-30T11:00:00.000Z',
            fileCount: 1,
            linesAdded: 4,
            linesDeleted: 1,
            commentCount: 0,
          },
        ]}
        activeCheckpointId="newer"
        loading={false}
        error={null}
        onOpenCheckpoint={vi.fn()}
      />,
    );

    expect(html).toContain('Newer change');
    expect(html).toContain('Older change');
    expect(html).toContain('10');
    expect(html).toContain('3');
    expect(html.indexOf('Newer change')).toBeLessThan(html.indexOf('Older change'));
  });

  it('shows a placeholder when no diff is selected', () => {
    const html = renderToString(
      <ConversationCheckpointWorkbenchPane conversationId="conv-1" checkpointId={null} />,
    );

    expect(html).toContain('Select a diff');
    expect(html).toContain('Pick a saved conversation diff');
  });
});
