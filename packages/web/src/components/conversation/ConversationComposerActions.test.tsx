import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConversationComposerActions } from './ConversationComposerActions';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const baseProps: React.ComponentProps<typeof ConversationComposerActions> = {
  dictationState: 'idle',
  composerDisabled: false,
  streamIsStreaming: false,
  conversationNeedsTakeover: false,
  composerHasContent: false,
  composerShowsQuestionSubmit: false,
  composerQuestionCanSubmit: false,
  composerQuestionSubmitting: false,
  composerSubmitLabel: 'Send',
  composerAltHeld: false,
  composerParallelHeld: false,
  onDictationPointerDown: vi.fn(),
  onDictationPointerUp: vi.fn(),
  onDictationPointerCancel: vi.fn(),
  onSubmitComposerQuestion: vi.fn(),
  onSubmitComposerActionForModifiers: vi.fn(),
  onAbortStream: vi.fn(),
};

function renderActions(overrides: Partial<React.ComponentProps<typeof ConversationComposerActions>> = {}) {
  return renderToString(<ConversationComposerActions {...baseProps} {...overrides} />);
}

describe('ConversationComposerActions', () => {
  it('renders disabled send affordance when composer has no content', () => {
    const html = renderActions();

    expect(html).toContain('Start dictation');
    expect(html).toContain('aria-label="Send"');
    expect(html).toContain('disabled=""');
  });

  it('renders normal send and queued action states', () => {
    expect(renderActions({ composerHasContent: true, composerSubmitLabel: 'Send' })).toContain('aria-label="Send"');
    expect(renderActions({ composerHasContent: true, composerSubmitLabel: 'Follow up' })).toContain('followup');
    expect(renderActions({ composerHasContent: true, composerSubmitLabel: 'Parallel' })).toContain('Parallel (Ctrl/⌘+Enter)');
  });

  it('renders streaming stop and steer controls', () => {
    const html = renderActions({
      streamIsStreaming: true,
      composerHasContent: true,
      composerSubmitLabel: 'Steer',
    });

    expect(html).toContain('steer');
    expect(html).toContain('aria-label="Stop"');
  });

  it('renders question submit and dictation busy states', () => {
    const html = renderActions({
      composerShowsQuestionSubmit: true,
      composerQuestionCanSubmit: true,
      composerQuestionSubmitting: true,
      dictationState: 'transcribing',
    });

    expect(html).toContain('Transcribing…');
    expect(html).toContain('Submitting…');
    expect(html).toContain('aria-label="Submit answers"');
  });
});
