import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ContextUsageIndicator } from './frontend';

const pa = {} as never;

describe('ContextUsageIndicator', () => {
  it('renders context usage label and accent tone under threshold', () => {
    const html = renderToString(
      <ContextUsageIndicator pa={pa} statusBarContext={{ contextUsage: { total: 70_000, contextWindow: 100_000 } }} />,
    );

    expect(html).toContain('Context usage: 70.0% of 100k ctx');
    expect(html).toContain('bg-warning');
  });

  it('uses danger tone near the context limit', () => {
    expect(
      renderToString(<ContextUsageIndicator pa={pa} statusBarContext={{ contextUsage: { total: 95_000, contextWindow: 100_000 } }} />),
    ).toContain('bg-danger');
  });

  it('does not render without context usage', () => {
    expect(renderToString(<ContextUsageIndicator pa={pa} statusBarContext={{}} />)).toBe('');
  });
});
