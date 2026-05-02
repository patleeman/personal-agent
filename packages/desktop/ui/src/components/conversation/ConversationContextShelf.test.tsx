import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConversationContextShelf } from './ConversationContextShelf';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('ConversationContextShelf', () => {
  it('renders attached context docs and prompt references', () => {
    const html = renderToString(
      <ConversationContextShelf
        attachedContextDocs={[{
          path: '/repo/README.md',
          title: 'README',
          kind: 'file',
          summary: 'Project readme',
        }]}
        draftMentionItems={[{
          kind: 'note',
          id: 'note:architecture',
          label: 'Architecture',
          title: 'Architecture note',
          summary: 'Helpful context',
          path: '/notes/architecture.md',
        }]}
        unattachedDraftMentionItems={[{
          kind: 'note',
          id: 'note:architecture',
          label: 'Architecture',
          path: '/notes/architecture.md',
        }]}
        contextDocsBusy={false}
        onRemoveAttachedContextDoc={vi.fn()}
        onAttachMentionedDocs={vi.fn()}
      />,
    );

    expect(html).toContain('Attached context');
    expect(html).toContain('README');
    expect(html).toContain('Remove README from attached context');
    expect(html).toContain('Prompt references');
    expect(html).toContain('attach 1');
    expect(html).toContain('note:architecture');
  });

  it('shows busy attach state while context docs are saving', () => {
    const html = renderToString(
      <ConversationContextShelf
        attachedContextDocs={[]}
        draftMentionItems={[{ kind: 'file', id: 'src/App.tsx', label: 'src/App.tsx', path: 'src/App.tsx' }]}
        unattachedDraftMentionItems={[{ kind: 'file', id: 'src/App.tsx', label: 'src/App.tsx', path: 'src/App.tsx' }]}
        contextDocsBusy
        onRemoveAttachedContextDoc={vi.fn()}
        onAttachMentionedDocs={vi.fn()}
      />,
    );

    expect(html).toContain('attaching…');
    expect(html).toContain('disabled=""');
  });
});
