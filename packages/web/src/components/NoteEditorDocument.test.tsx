import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NoteEditorDocument } from './NoteEditorDocument';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('NoteEditorDocument', () => {
  it('keeps the tag rail mounted even when there are no inferred tags', () => {
    const html = renderToString(
      <NoteEditorDocument
        title="Example"
        onTitleChange={() => {}}
        body=""
        onBodyChange={() => {}}
        path="example.md"
        inferredTags={[]}
      />,
    );

    expect(html).toContain('ui-note-inline-tags');
  });

  it('renders inferred tag pills in the reserved tag rail', () => {
    const html = renderToString(
      <NoteEditorDocument
        title="Example"
        onTitleChange={() => {}}
        body=""
        onBodyChange={() => {}}
        path="example.md"
        inferredTags={['notes', 'agent']}
      />,
    );

    expect(html).toContain('#notes');
    expect(html).toContain('#agent');
  });
});
