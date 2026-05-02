import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConversationSavedHeader } from './ConversationSavedHeader.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('ConversationSavedHeader', () => {
  it('makes the title itself the rename trigger when editing is enabled', () => {
    const html = renderToString(
      <ConversationSavedHeader
        title="Fix the top bar"
        cwd="/tmp/personal-agent"
        onTitleClick={() => {}}
        cwdEditing={false}
        cwdDraft="/tmp/personal-agent"
        onCwdDraftChange={() => {}}
        onCancelEditingCwd={() => {}}
        onSaveCwd={() => {}}
      />,
    );

    expect(html).toContain('aria-label="Rename conversation: Fix the top bar"');
    expect(html).toContain('>Fix the top bar<');
  });

  it('keeps the saved conversation top bar focused on the title', () => {
    const html = renderToString(
      <ConversationSavedHeader
        title="Fix the top bar"
        cwd="/tmp/personal-agent"
        cwdEditing={false}
        cwdDraft="/tmp/personal-agent"
        onCwdDraftChange={() => {}}
        onCancelEditingCwd={() => {}}
        onSaveCwd={() => {}}
      />,
    );

    expect(html).toContain('Fix the top bar');
    expect(html).not.toContain('/tmp/personal-agent');
    expect(html).not.toContain('Choose a new working directory for this conversation');
    expect(html).not.toContain('Enter the working directory manually');
    expect(html).not.toContain('Running');
    expect(html).not.toContain('Needs review');
  });

  it('renders the inline cwd editor when requested', () => {
    const html = renderToString(
      <ConversationSavedHeader
        title="Fix the top bar"
        cwd="/tmp/personal-agent"
        cwdEditing
        cwdDraft="/tmp/other-repo"
        cwdError="Directory does not exist"
        onCwdDraftChange={() => {}}
        onCancelEditingCwd={() => {}}
        onSaveCwd={() => {}}
      />,
    );

    expect(html).toContain('aria-label="Conversation working directory"');
    expect(html).toContain('/tmp/other-repo');
    expect(html).toContain('>Switch<');
    expect(html).toContain('>Cancel<');
    expect(html).toContain('Directory does not exist');
  });
});
