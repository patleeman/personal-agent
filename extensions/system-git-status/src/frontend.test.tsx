import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GitStatusIndicator } from './frontend';

const pa = {} as never;

describe('GitStatusIndicator', () => {
  it('renders branch and diff summary from status bar context', () => {
    const html = renderToString(
      <GitStatusIndicator
        pa={pa}
        statusBarContext={{
          branchLabel: 'main',
          gitSummary: { kind: 'diff', added: '+12', deleted: '-3' },
        }}
      />,
    );

    expect(html).toContain('main');
    expect(html).toContain('+12');
    expect(html).toContain('-3');
  });

  it('does not render without branch or git summary', () => {
    expect(renderToString(<GitStatusIndicator pa={pa} statusBarContext={{ gitSummary: { kind: 'none' } }} />)).toBe('');
  });
});
