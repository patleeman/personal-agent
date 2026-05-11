import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ConversationComposerActions } from './ConversationComposerActions';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const baseProps: React.ComponentProps<typeof ConversationComposerActions> = {
  composerDisabled: false,
  streamIsStreaming: false,
  conversationNeedsTakeover: false,
  composerHasContent: false,
  composerShowsQuestionSubmit: false,
  composerQuestionCanSubmit: false,
  composerQuestionRemainingCount: 0,
  composerQuestionSubmitting: false,
  composerSubmitLabel: 'Send',
  composerAltHeld: false,
  composerParallelHeld: false,
  onInsertComposerText: vi.fn(),
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

  it('renders stop button only when streaming with no content', () => {
    const html = renderActions({
      streamIsStreaming: true,
      composerHasContent: false,
      composerSubmitLabel: 'Steer',
    });

    // Stop button is still shown
    expect(html).toContain('aria-label="Stop"');
    // No submit button when there's no content
    expect(html).not.toContain('steer');
    expect(html).not.toContain('followup');
    expect(html).not.toContain('Parallel');
  });

  it('renders follow-up button while streaming when alt is held', () => {
    const html = renderActions({
      streamIsStreaming: true,
      composerHasContent: true,
      composerSubmitLabel: 'Follow up',
    });

    expect(html).toContain('followup');
    expect(html).toContain('aria-label="Stop"');
  });

  it('renders parallel button while streaming when modifier is held', () => {
    const html = renderActions({
      streamIsStreaming: true,
      composerHasContent: true,
      composerSubmitLabel: 'Parallel',
    });

    expect(html).toContain('Parallel (Ctrl/⌘+Enter)');
    expect(html).toContain('aria-label="Stop"');
  });

  it('does not render stop button when not streaming', () => {
    const html = renderActions({
      streamIsStreaming: false,
      composerHasContent: true,
      composerSubmitLabel: 'Send',
    });

    expect(html).not.toContain('aria-label="Stop"');
  });

  it('renders question submit busy state', () => {
    const html = renderActions({
      composerShowsQuestionSubmit: true,
      composerQuestionCanSubmit: true,
      composerQuestionSubmitting: true,
    });

    expect(html).toContain('Submitting…');
    expect(html).toContain('aria-label="Submit answers"');
  });

  it('shows why question submit is disabled when answers are missing', () => {
    const html = renderActions({
      composerShowsQuestionSubmit: true,
      composerQuestionCanSubmit: false,
      composerQuestionRemainingCount: 2,
    });

    expect(html).toContain('2 left');
    expect(html).toContain('Answer 2 more questions to submit');
  });
});
