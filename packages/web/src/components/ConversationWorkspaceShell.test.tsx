import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ConversationWorkspaceShell } from './ConversationWorkspaceShell.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('ConversationWorkspaceShell', () => {
  it('keeps the right rail closed by default', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/conv-123']}>
        <ConversationWorkspaceShell>
          {({ railOpen }) => <div>{railOpen ? 'open' : 'closed'}</div>}
        </ConversationWorkspaceShell>
      </MemoryRouter>,
    );

    expect(html).toContain('closed');
    expect(html).not.toContain('aria-label="Conversation context"');
  });
});
