import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SuggestedContextShelf } from './frontend';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('SuggestedContextShelf', () => {
  it('renders suggested context results from composer shelf state', () => {
    const html = renderToString(
      <SuggestedContextShelf
        shelfContext={{
          suggestedContext: {
            query: 'architecture',
            results: [
              {
                sessionId: 'conv-1',
                title: 'Architecture pass',
                cwd: '/repo',
                timestamp: '2026-04-01T00:00:00.000Z',
                snippet: 'Split the page',
                matchedTerms: ['architecture'],
                score: 10,
                sameWorkspace: true,
              },
            ],
            selectedSessionIds: ['conv-1'],
            autoSelectedSessionIds: [],
            loading: false,
            busy: false,
            error: null,
            maxSelections: 3,
            hotkeyLimit: 5,
            onToggle: vi.fn(),
          },
        }}
      />,
    );

    expect(html).toContain('Suggested context');
    expect(html).toContain('Auto-ranked from past conversations.');
    expect(html).toContain('Architecture pass');
    expect(html).toContain('Split the page');
    expect(html).toContain('1/3 selected');
  });

  it('stays hidden when there is no active query or state', () => {
    expect(renderToString(<SuggestedContextShelf shelfContext={{}} />)).toBe('');
    expect(
      renderToString(
        <SuggestedContextShelf
          shelfContext={{
            suggestedContext: {
              query: '',
              results: [],
              selectedSessionIds: [],
              autoSelectedSessionIds: [],
              loading: false,
              busy: false,
              error: null,
              maxSelections: 3,
              hotkeyLimit: 5,
              onToggle: vi.fn(),
            },
          }}
        />,
      ),
    ).toBe('');
  });
});
