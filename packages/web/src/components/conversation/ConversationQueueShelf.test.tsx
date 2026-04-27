import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConversationQueueShelf } from './ConversationQueueShelf';
import type { ParallelPromptPreview } from '../../shared/types';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const parallelJob: ParallelPromptPreview = {
  id: 'job-1',
  prompt: 'Check the tests',
  childConversationId: 'conv-child',
  status: 'ready',
  imageCount: 1,
  attachmentRefs: ['docs/spec.md'],
  touchedFiles: ['src/a.ts'],
  parentTouchedFiles: ['src/b.ts'],
  overlapFiles: ['src/shared.ts'],
  sideEffects: ['created files'],
  resultPreview: 'Looks good',
};

describe('ConversationQueueShelf', () => {
  it('renders queued prompts with restore and remote states', () => {
    const html = renderToString(
      <ConversationQueueShelf
        pendingQueue={[
          { id: 'steer-1', text: 'Steer this', imageCount: 0, restorable: true, type: 'steer', queueIndex: 0 },
          { id: 'follow-1', text: '', imageCount: 2, restorable: false, type: 'followUp', queueIndex: 0 },
        ]}
        parallelJobs={[]}
        conversationNeedsTakeover={false}
        onRestoreQueuedPrompt={vi.fn()}
        onManageParallelJob={vi.fn()}
        onOpenConversation={vi.fn()}
      />,
    );

    expect(html).toContain('Queued');
    expect(html).toContain('⤵ steer');
    expect(html).toContain('Steer this');
    expect(html).toContain('restore');
    expect(html).toContain('↷ followup');
    expect(html).toContain('(image only)');
    expect(html).toContain('2 images attached');
    expect(html).toContain('remote');
  });

  it('renders parallel job details and actions', () => {
    const html = renderToString(
      <ConversationQueueShelf
        pendingQueue={[]}
        parallelJobs={[parallelJob]}
        conversationNeedsTakeover={false}
        onRestoreQueuedPrompt={vi.fn()}
        onManageParallelJob={vi.fn()}
        onOpenConversation={vi.fn()}
      />,
    );

    expect(html).toContain('Parallel');
    expect(html).toContain('queued');
    expect(html).toContain('Check the tests');
    expect(html).toContain('1 image · 1 attachment');
    expect(html).toContain('attachments:');
    expect(html).toContain('docs/spec.md');
    expect(html).toContain('files:');
    expect(html).toContain('src/a.ts');
    expect(html).toContain('parent:');
    expect(html).toContain('src/b.ts');
    expect(html).toContain('overlap:');
    expect(html).toContain('src/shared.ts');
    expect(html).toContain('effects:');
    expect(html).toContain('created files');
    expect(html).toContain('Looks good');
    expect(html).toContain('import');
    expect(html).toContain('skip');
    expect(html).toContain('open');
  });
});
