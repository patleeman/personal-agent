import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ModelInfo } from '../../shared/types';
import { ConversationComposerInputControls } from './ConversationComposerInputControls';
import { ConversationRunModePanel } from './ConversationRunModePanel';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const models: ModelInfo[] = [
  {
    id: 'model-a',
    provider: 'Provider A',
    name: 'Model A',
    context: 128000,
    supportedServiceTiers: ['priority'],
  },
];

function renderControls(overrides: Partial<React.ComponentProps<typeof ConversationComposerInputControls>> = {}) {
  return renderToString(
    <ConversationComposerInputControls
      fileInputRef={{ current: null }}
      textareaRef={{ current: null }}
      input=""
      pendingAskUserQuestion={false}
      composerDisabled={false}
      composerShellWidth={800}
      streamIsStreaming={false}
      models={models}
      currentModel="model-a"
      currentThinkingLevel="medium"
      currentServiceTier="priority"
      savingPreference={null}
      showAutoModeToggle
      conversationAutoModeEnabled={false}
      conversationAutoModeBusy={false}
      dictationState="idle"
      dictationLevelSamples={[]}
      dictationStartedAt={null}
      conversationNeedsTakeover={false}
      composerHasContent={false}
      composerShowsQuestionSubmit={false}
      composerQuestionCanSubmit={false}
      composerQuestionRemainingCount={0}
      composerQuestionSubmitting={false}
      composerSubmitLabel="Send"
      composerAltHeld={false}
      composerParallelHeld={false}
      onFilesSelected={vi.fn()}
      onInputChange={vi.fn()}
      onRememberComposerSelection={vi.fn()}
      onKeyDown={vi.fn()}
      onPaste={vi.fn()}
      onOpenFilePicker={vi.fn()}
      onOpenDrawingEditor={vi.fn()}
      onSelectModel={vi.fn()}
      onSelectThinkingLevel={vi.fn()}
      onSelectServiceTier={vi.fn()}
      onToggleAutoMode={vi.fn()}
      onDictationPointerDown={vi.fn()}
      onDictationPointerUp={vi.fn()}
      onDictationPointerCancel={vi.fn()}
      onSubmitComposerQuestion={vi.fn()}
      onSubmitComposerActionForModifiers={vi.fn()}
      onAbortStream={vi.fn()}
      {...overrides}
    />,
  );
}

describe('ConversationComposerInputControls', () => {
  it('renders textarea, attachment controls, preferences, dictation, and disabled send', () => {
    const html = renderControls();

    expect(html).toContain('Message… / commands, @ notes');
    expect(html).toContain('Attach image or file');
    expect(html).toContain('Create drawing');
    expect(html).toContain('Conversation model');
    expect(html).toContain('Start dictation');
    expect(html).toContain('aria-label="Send"');
  });

  it('renders question-submit states', () => {
    const html = renderControls({
      pendingAskUserQuestion: true,
      composerShowsQuestionSubmit: true,
      composerQuestionCanSubmit: true,
      composerSubmitLabel: 'Send',
    });

    expect(html).toContain('Answer 1-9, or type to skip…');
    expect(html).toContain('Submit answers');
  });

  it('renders active mission tasks in the run-mode shelf', () => {
    const html = renderToString(
      <ConversationRunModePanel
        mode="mission"
        running
        mission={{
          goal: 'Fix the page',
          tasks: [
            { id: 't1', description: 'Run tests', status: 'done' },
            { id: 't2', description: 'Patch bug', status: 'pending' },
          ],
          maxTurns: 20,
          turnsUsed: 2,
        }}
      />,
    );

    expect(html).toContain('Tasks');
    expect(html).toContain('Patch bug');
    expect(html).toContain('aria-label="Mission goal"');
    expect(html).toContain('aria-label="Mission max turns"');
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('Goal: what should be accomplished?');
  });

  it('keeps active loop controls visible in the run-mode shelf', () => {
    const html = renderToString(
      <ConversationRunModePanel
        mode="loop"
        running
        draftLoop={{ prompt: 'Find bugs', maxIterations: 5, delay: '2s' }}
        loop={{
          prompt: 'Find bugs',
          maxIterations: 5,
          iterationsUsed: 2,
          delay: '2s',
        }}
      />,
    );

    expect(html).toContain('Run');
    expect(html).toContain('Prompt to repeat each iteration');
    expect(html).toContain('aria-label="Loop prompt"');
    expect(html).toContain('aria-label="Loop max iterations"');
    expect(html).toContain('aria-label="Loop delay"');
    expect(html).toContain('<select');
    expect(html).toContain('value="2s"');
    expect(html).not.toContain('>Repeat</span>');
  });

  it('renders the dictation waveform while recording', () => {
    const html = renderControls({
      dictationState: 'recording',
      dictationStartedAt: 1000,
      dictationLevelSamples: [0.1, 0.8, 0.2],
    });

    expect(html).toContain('Recording dictation');
    expect(html).toContain('Stop dictation');
  });
});
