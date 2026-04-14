import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RelatedConversationSearchResult } from '../relatedConversationSearch.js';
import { DraftRelatedThreadsPanel } from './DraftRelatedThreadsPanel.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('DraftRelatedThreadsPanel', () => {
  it('renders row hotkeys and the custom checkbox shell for visible results', () => {
    const results: RelatedConversationSearchResult[] = [
      {
        sessionId: 'conv-1',
        title: 'Release signing flow',
        cwd: '/repo/current',
        timestamp: '2026-04-12T09:00:00.000Z',
        snippet: 'Mapped APPLE_PASSWORD for the release flow.',
        matchedTerms: ['release', 'signing'],
        score: 180,
        sameWorkspace: true,
      },
      {
        sessionId: 'conv-2',
        title: 'Auto mode wakeups',
        cwd: '/repo/current',
        timestamp: '2026-04-11T09:00:00.000Z',
        snippet: 'Wakeups use durable run callbacks.',
        matchedTerms: ['wakeups'],
        score: 140,
        sameWorkspace: true,
      },
    ];

    const html = renderToString(
      <DraftRelatedThreadsPanel
        query="release"
        results={results}
        selectedSessionIds={['conv-1']}
        selectedCount={1}
        loading={false}
        busy={false}
        error={null}
        maxSelections={3}
        onToggle={() => {}}
      />,
    );

    expect(html).toContain('Ctrl+1');
    expect(html).toContain('Ctrl+2');
    expect(html).toContain('appearance-none');
    expect(html).toContain('Reuse context from Release signing flow');
    expect(html).toContain('after:rotate-45');
  });
});
