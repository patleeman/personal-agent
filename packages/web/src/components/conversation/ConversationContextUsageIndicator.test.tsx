import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConversationContextUsageIndicator } from './ConversationContextUsageIndicator';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('ConversationContextUsageIndicator', () => {
  it('renders an accessible context usage label', () => {
    const html = renderToString(
      <ConversationContextUsageIndicator tokens={{ total: 70_000, contextWindow: 100_000 }} />,
    );

    expect(html).toContain('role="img"');
    expect(html).toContain('Context usage:');
    expect(html).toContain('70');
    expect(html).toContain('bg-warning');
  });

  it('uses danger styling for near-full context and dim styling for unknown totals', () => {
    expect(renderToString(
      <ConversationContextUsageIndicator tokens={{ total: 95_000, contextWindow: 100_000 }} />,
    )).toContain('bg-danger');

    expect(renderToString(
      <ConversationContextUsageIndicator tokens={{ total: null, contextWindow: 100_000 }} />,
    )).toContain('bg-dim/70');
  });
});
