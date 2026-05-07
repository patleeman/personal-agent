// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ModelInfo } from '../../shared/types';
import { ConversationComposerInputControls } from './ConversationComposerInputControls';
import { ConversationRunModePanel } from './ConversationRunModePanel';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const models: ModelInfo[] = [
  {
    id: 'model-a',
    provider: 'Provider A',
    name: 'Model A',
    context: 128000,
    supportedServiceTiers: ['priority'],
  },
];

function renderInteractive(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });

  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

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
        }}
        onAddMissionTask={vi.fn()}
      />,
    );

    expect(html).toContain('Tasks');
    expect(html).toContain('Patch bug');
    expect(html).toContain('aria-label="Mission goal"');
    expect(html).toContain('aria-label="Add mission task"');
    expect(html).not.toContain('aria-label="Mission goal" disabled');
    expect(html).not.toContain('Goal: what should be accomplished?');
  });

  it('commits mission goal edit on blur', () => {
    const onDraftMissionChange = vi.fn();
    const rendered = renderInteractive(
      <ConversationRunModePanel
        mode="mission"
        running
        mission={{
          goal: 'Fix the page',
          tasks: [{ id: 't1', description: 'Run tests', status: 'pending' }],
        }}
        onDraftMissionChange={onDraftMissionChange}
      />,
    );

    try {
      const goal = rendered.container.querySelector<HTMLInputElement>('input[aria-label="Mission goal"]');
      expect(goal).toBeTruthy();

      act(() => {
        setInputValue(goal!, 'Ship the thing');
        goal!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      });
      expect(onDraftMissionChange).toHaveBeenLastCalledWith({ goal: 'Ship the thing' });
    } finally {
      rendered.unmount();
    }
  });

  it('submits and clears manually added mission tasks', () => {
    const onAddMissionTask = vi.fn();
    const rendered = renderInteractive(
      <ConversationRunModePanel
        mode="mission"
        running
        mission={{
          goal: 'Fix the page',
          tasks: [],
        }}
        onAddMissionTask={onAddMissionTask}
      />,
    );

    try {
      const taskInput = rendered.container.querySelector<HTMLInputElement>('input[aria-label="Add mission task"]');
      const addButton = rendered.container.querySelector<HTMLButtonElement>('button[type="submit"]');
      expect(taskInput).toBeTruthy();
      expect(addButton).toBeTruthy();
      expect(addButton!.disabled).toBe(true);

      act(() => {
        setInputValue(taskInput!, '  Inspect persistence  ');
      });
      expect(addButton!.disabled).toBe(false);

      act(() => {
        addButton!.click();
      });
      expect(onAddMissionTask).toHaveBeenCalledWith('Inspect persistence');
      expect(taskInput!.value).toBe('');
      expect(addButton!.disabled).toBe(true);
    } finally {
      rendered.unmount();
    }
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
