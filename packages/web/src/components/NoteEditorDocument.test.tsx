import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoteEditorDocument } from './NoteEditorDocument';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('NoteEditorDocument', () => {
  it('renders note meta when provided', () => {
    const html = renderToString(
      <NoteEditorDocument
        title="Example"
        onTitleChange={() => {}}
        description="Use this when the user asks about note routing."
        onDescriptionChange={() => {}}
        body=""
        onBodyChange={() => {}}
        meta={<><span>@example</span><span>updated just now</span></>}
      />,
    );

    expect(html).toContain('@example');
    expect(html).toContain('updated just now');
    expect(html).toContain('For the agent (optional)');
    expect(html).toContain('Use this when the user asks about note routing.');
  });

  it('does not render the old inline tag rail', () => {
    const html = renderToString(
      <NoteEditorDocument
        title="Example"
        onTitleChange={() => {}}
        description=""
        onDescriptionChange={() => {}}
        body=""
        onBodyChange={() => {}}
      />,
    );

    expect(html).not.toContain('ui-note-inline-tags');
    expect(html).not.toContain('ui-note-tag-link');
  });
});
