import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ConversationGoalPanel } from './ConversationGoalPanel';

describe('ConversationGoalPanel', () => {
  it('renders goal work status inline with the active badge', () => {
    const html = renderToStaticMarkup(
      <ConversationGoalPanel
        goal={{ objective: 'Ship goal mode', status: 'active', tasks: [], stopReason: null, updatedAt: null }}
        workingLabel="Working…"
      />,
    );

    expect(html).toContain('Goal');
    expect(html).toContain('Ship goal mode');
    expect(html).toContain('Active');
    expect(html).toContain('Working…');
    expect(html.indexOf('Active')).toBeLessThan(html.indexOf('Working…'));
  });

  it('does not render completed goals in the composer', () => {
    const html = renderToStaticMarkup(
      <ConversationGoalPanel goal={{ objective: 'Ship goal mode', status: 'complete', tasks: [], stopReason: null, updatedAt: null }} />,
    );

    expect(html).toBe('');
  });
});
