import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isAskUserQuestionComplete,
  moveAskUserQuestionIndex,
  resolveAskUserQuestionDefaultOptionIndex,
  resolveAskUserQuestionNavigationHotkey,
  resolveAskUserQuestionOptionHotkey,
  shouldAdvanceAskUserQuestionAfterSelection,
  type AskUserQuestionAnswers,
  type AskUserQuestionPresentation,
} from '../../transcript/askUserQuestions';
import type { MessageBlock } from '../../shared/types';
import { Pill, SurfacePanel, cx } from '../ui';

export interface AskUserQuestionState {
  status: 'pending' | 'answered' | 'superseded';
  answerBlock?: Extract<MessageBlock, { type: 'user' }>;
}

export function describeAskUserQuestionState(messages: MessageBlock[] | undefined, messageIndex: number | undefined): AskUserQuestionState {
  if (!messages || typeof messageIndex !== 'number') {
    return { status: 'pending' };
  }

  for (let index = messageIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index];
    if (!candidate) {
      continue;
    }

    if (candidate.type === 'user') {
      return { status: 'answered', answerBlock: candidate };
    }

    if (candidate.type === 'tool_use' && candidate.tool === 'ask_user_question') {
      return { status: 'superseded' };
    }
  }

  return { status: 'pending' };
}

export function summarizeAskUserQuestionAnswer(block: Extract<MessageBlock, { type: 'user' }> | undefined): string | null {
  if (!block) {
    return null;
  }

  const text = block.text.trim().replace(/\s+/g, ' ');
  if (text.length > 0) {
    return text.length > 180 ? `${text.slice(0, 179)}…` : text;
  }

  const imageCount = block.images?.length ?? 0;
  if (imageCount > 0) {
    return imageCount === 1 ? 'Sent 1 image attachment.' : `Sent ${imageCount} image attachments.`;
  }

  return null;
}

export function AskUserQuestionToolBlock({
  block,
  presentation,
  state,
  onSubmit,
  mode = 'inline',
}: {
  block: Extract<MessageBlock, { type: 'tool_use' }>;
  presentation: AskUserQuestionPresentation;
  state: AskUserQuestionState;
  onSubmit?: (presentation: AskUserQuestionPresentation, answers: AskUserQuestionAnswers) => Promise<void> | void;
  mode?: 'inline' | 'composer';
}) {
  const isRunning = block.status === 'running' || !!block.running;
  const answerPreview = summarizeAskUserQuestionAnswer(state.answerBlock);
  const statusLabel = state.status === 'answered'
    ? 'answered'
    : state.status === 'superseded'
      ? 'replaced'
      : isRunning
        ? 'asking…'
        : 'waiting';
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const [answers, setAnswers] = useState<AskUserQuestionAnswers>({});
  const [submitting, setSubmitting] = useState(false);
  const questionTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const questionIdsKey = useMemo(
    () => presentation.questions.map((question) => question.id).join('|'),
    [presentation.questions],
  );

  useEffect(() => {
    setActiveQuestionIndex(0);
    setActiveOptionIndex(0);
    setAnswers({});
    setSubmitting(false);
  }, [questionIdsKey]);

  const activeQuestion = presentation.questions[Math.max(0, Math.min(activeQuestionIndex, presentation.questions.length - 1))] ?? null;

  useEffect(() => {
    if (!activeQuestion) {
      setActiveOptionIndex(0);
      optionRefs.current = [];
      return;
    }

    setActiveOptionIndex(resolveAskUserQuestionDefaultOptionIndex(activeQuestion, answers));
    optionRefs.current = [];
  }, [activeQuestion, activeQuestionIndex, answers, questionIdsKey]);

  const answeredCount = presentation.questions.filter((question) => (answers[question.id]?.length ?? 0) > 0).length;
  const hasInteractiveOptions = presentation.questions.some((question) => question.options.length > 0);
  const canSubmit = hasInteractiveOptions && isAskUserQuestionComplete(presentation, answers) && Boolean(onSubmit);
  const submitLabel = submitting ? 'Submitting…' : '✓ Submit →';

  const focusQuestionTab = useCallback((index: number) => {
    window.requestAnimationFrame(() => {
      questionTabRefs.current[index]?.focus();
    });
  }, []);

  const focusSubmitButton = useCallback(() => {
    window.requestAnimationFrame(() => {
      submitButtonRef.current?.focus();
    });
  }, []);

  const focusOption = useCallback((index: number) => {
    window.requestAnimationFrame(() => {
      optionRefs.current[index]?.focus();
    });
  }, []);

  const activateQuestion = useCallback((index: number, options?: { focus?: 'tab' | 'option' }) => {
    const nextIndex = Math.max(0, Math.min(index, presentation.questions.length - 1));
    const nextQuestion = presentation.questions[nextIndex];
    const nextOptionIndex = resolveAskUserQuestionDefaultOptionIndex(nextQuestion, answers);
    setActiveQuestionIndex(nextIndex);
    setActiveOptionIndex(nextOptionIndex >= 0 ? nextOptionIndex : 0);

    if (options?.focus === 'tab') {
      focusQuestionTab(nextIndex);
    } else if (options?.focus === 'option') {
      if (nextOptionIndex >= 0) {
        focusOption(nextOptionIndex);
      } else {
        focusQuestionTab(nextIndex);
      }
    }
  }, [answers, focusOption, focusQuestionTab, presentation.questions]);

  const submitIfReady = useCallback(async () => {
    if (!onSubmit || !canSubmit) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(presentation, answers);
    } finally {
      setSubmitting(false);
    }
  }, [answers, canSubmit, onSubmit, presentation]);

  const advanceAfterAnswer = useCallback((questionIndex: number, nextAnswers: AskUserQuestionAnswers) => {
    const nextQuestionIndex = questionIndex + 1;
    if (nextQuestionIndex < presentation.questions.length) {
      const nextQuestion = presentation.questions[nextQuestionIndex];
      const nextOptionIndex = resolveAskUserQuestionDefaultOptionIndex(nextQuestion, nextAnswers);
      setActiveQuestionIndex(nextQuestionIndex);
      setActiveOptionIndex(nextOptionIndex >= 0 ? nextOptionIndex : 0);
      if (nextOptionIndex >= 0) {
        focusOption(nextOptionIndex);
      } else {
        focusQuestionTab(nextQuestionIndex);
      }
      return;
    }

    if (isAskUserQuestionComplete(presentation, nextAnswers)) {
      focusSubmitButton();
    }
  }, [focusOption, focusQuestionTab, focusSubmitButton, presentation]);

  const applyRadioAnswer = useCallback((questionIndex: number, value: string) => {
    const question = presentation.questions[questionIndex];
    if (!question) {
      return;
    }

    const nextValues = [value];
    const nextAnswers = {
      ...answers,
      [question.id]: nextValues,
    };
    setAnswers(nextAnswers);
    if (shouldAdvanceAskUserQuestionAfterSelection(question, nextValues)) {
      advanceAfterAnswer(questionIndex, nextAnswers);
    }
  }, [advanceAfterAnswer, answers, presentation.questions]);

  const applyCheckAnswer = useCallback((questionIndex: number, value: string) => {
    const question = presentation.questions[questionIndex];
    if (!question) {
      return;
    }

    const currentValues = answers[question.id] ?? [];
    const alreadySelected = currentValues.includes(value);
    const nextValues = alreadySelected
      ? currentValues.filter((candidate) => candidate !== value)
      : [...currentValues, value];
    const nextAnswers = {
      ...answers,
      [question.id]: nextValues,
    };

    setAnswers(nextAnswers);
    if (shouldAdvanceAskUserQuestionAfterSelection(question, nextValues)) {
      advanceAfterAnswer(questionIndex, nextAnswers);
    }
  }, [advanceAfterAnswer, answers, presentation.questions]);

  const handleOptionSelect = useCallback((questionIndex: number, optionIndex: number) => {
    const question = presentation.questions[questionIndex];
    const option = question?.options[optionIndex];
    if (!question || !option || submitting) {
      return;
    }

    setActiveOptionIndex(optionIndex);
    if (question.style === 'check') {
      applyCheckAnswer(questionIndex, option.value);
      return;
    }

    applyRadioAnswer(questionIndex, option.value);
  }, [applyCheckAnswer, applyRadioAnswer, presentation.questions, submitting]);

  const handleQuestionTabKeyDown = useCallback((index: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      activateQuestion(Math.max(0, index - 1), { focus: 'tab' });
      return;
    }

    if (event.key === 'ArrowRight' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      if (index >= presentation.questions.length - 1) {
        focusSubmitButton();
      } else {
        activateQuestion(index + 1, { focus: 'tab' });
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (activeQuestion?.options.length) {
        focusOption(activeOptionIndex);
      }
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (activeQuestion?.options.length) {
        focusOption(activeOptionIndex);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }, [activateQuestion, activeOptionIndex, activeQuestion?.options.length, focusOption, focusSubmitButton, presentation.questions.length]);

  const handleSubmitKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      activateQuestion(presentation.questions.length - 1, { focus: 'tab' });
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (activeQuestion?.options.length) {
        focusOption(activeOptionIndex);
      }
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void submitIfReady();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }, [activateQuestion, activeOptionIndex, activeQuestion?.options.length, focusOption, presentation.questions.length, submitIfReady]);

  const handleOptionKeyDown = useCallback((optionIndex: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!activeQuestion) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = moveAskUserQuestionIndex(optionIndex, activeQuestion.options.length, 1);
      setActiveOptionIndex(nextIndex);
      focusOption(nextIndex);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = moveAskUserQuestionIndex(optionIndex, activeQuestion.options.length, -1);
      setActiveOptionIndex(nextIndex);
      focusOption(nextIndex);
      return;
    }

    if (event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      activateQuestion(Math.max(0, activeQuestionIndex - 1), { focus: 'tab' });
      return;
    }

    if (event.key === 'ArrowRight' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      if (activeQuestionIndex >= presentation.questions.length - 1) {
        focusSubmitButton();
      } else {
        activateQuestion(activeQuestionIndex + 1, { focus: 'tab' });
      }
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOptionSelect(activeQuestionIndex, optionIndex);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }, [activeQuestion, activeQuestionIndex, activateQuestion, focusOption, focusSubmitButton, handleOptionSelect, presentation.questions.length]);

  const handlePanelHotkeys = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || submitting || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const optionHotkeyIndex = resolveAskUserQuestionOptionHotkey(event.key);
    if (activeQuestion && optionHotkeyIndex >= 0 && optionHotkeyIndex < activeQuestion.options.length) {
      event.preventDefault();
      handleOptionSelect(activeQuestionIndex, optionHotkeyIndex);
      return;
    }

    const questionDirection = resolveAskUserQuestionNavigationHotkey(event.key);
    if (questionDirection === 0) {
      return;
    }

    event.preventDefault();
    if (questionDirection > 0) {
      if (activeQuestionIndex >= presentation.questions.length - 1) {
        focusSubmitButton();
      } else {
        activateQuestion(activeQuestionIndex + 1, { focus: 'option' });
      }
      return;
    }

    activateQuestion(Math.max(0, activeQuestionIndex - 1), { focus: 'option' });
  }, [activeQuestion, activeQuestionIndex, activateQuestion, focusSubmitButton, handleOptionSelect, presentation.questions.length, submitting]);

  const statusTone = state.status === 'answered'
    ? 'success'
    : state.status === 'superseded'
      ? 'muted'
      : 'warning';

  return (
    <SurfacePanel
      muted
      className={cx(
        'px-3 py-2.5 text-[12px] transition-colors',
        state.status === 'pending' && 'border-warning/25 bg-warning/5',
      )}
      onKeyDownCapture={mode === 'inline' ? handlePanelHotkeys : undefined}
    >
      <div className="flex items-start gap-2.5">
        <div className="ui-chat-avatar mt-0.5">
          <span className="ui-chat-avatar-mark">?</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-medium text-primary">
              {presentation.questions.length === 1 ? 'Question for you' : 'Questions for you'}
            </span>
            <Pill tone={statusTone}>{statusLabel}</Pill>
            {mode === 'inline' && state.status === 'pending' && presentation.questions.length > 1 && (
              <span className="text-[10px] uppercase tracking-[0.14em] text-dim/65">
                {answeredCount}/{presentation.questions.length} answered
              </span>
            )}
          </div>

          {state.status === 'pending' ? (
            mode === 'composer' ? (
              <>
                {presentation.details && (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-secondary break-words">{presentation.details}</p>
                )}
                <div className="mt-2 space-y-1">
                  {presentation.questions.map((question, index) => (
                    <p key={question.id} className="flex items-start gap-2 text-[13px] leading-relaxed text-secondary">
                      <span className="mt-px w-4 shrink-0 text-[11px] font-mono text-dim">{index + 1}.</span>
                      <span className="min-w-0 break-words">{question.label}</span>
                    </p>
                  ))}
                </div>
                <p className="mt-2 text-[12px] text-dim">
                  Answer using the composer below. Type 1-9 to select, or send a normal message to skip.
                </p>
              </>
            ) : (
              <>
                {presentation.details && (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-secondary break-words">{presentation.details}</p>
                )}

                <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-1" role="tablist" aria-label="Question navigation">
                  {presentation.questions.map((question, index) => {
                    const answered = (answers[question.id]?.length ?? 0) > 0;
                    const active = index === activeQuestionIndex;
                    return (
                      <button
                        key={question.id}
                        ref={(node) => { questionTabRefs.current[index] = node; }}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-controls={`ask-user-question-panel-${question.id}`}
                        onClick={() => activateQuestion(index)}
                        onKeyDown={(event) => handleQuestionTabKeyDown(index, event)}
                        className={cx(
                          'ui-action-button min-w-0 px-1.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                          active
                            ? 'text-primary hover:text-primary'
                            : answered
                              ? 'text-secondary'
                              : 'text-dim',
                        )}
                      >
                        <span aria-hidden="true" className={cx('shrink-0 text-[11px]', answered ? 'text-success' : active ? 'text-accent' : 'text-dim/70')}>
                          {answered ? '✓' : active ? '•' : '○'}
                        </span>
                        <span className="truncate">{question.label}</span>
                      </button>
                    );
                  })}
                  {hasInteractiveOptions && onSubmit && (
                    <button
                      ref={submitButtonRef}
                      type="button"
                      disabled={!canSubmit || submitting}
                      onClick={() => { void submitIfReady(); }}
                      onKeyDown={handleSubmitKeyDown}
                      className={cx(
                        'ui-action-button px-1.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                        canSubmit && !submitting ? 'text-accent' : 'text-dim',
                      )}
                    >
                      {submitLabel}
                    </button>
                  )}
                </div>

                {activeQuestion && (
                  <div id={`ask-user-question-panel-${activeQuestion.id}`} role="tabpanel" className="mt-2.5 border-t border-border-subtle pt-2.5">
                    {presentation.questions.length > 1 && (
                      <p className="text-[10px] uppercase tracking-[0.14em] text-dim/65">
                        Question {activeQuestionIndex + 1} of {presentation.questions.length}
                      </p>
                    )}
                    <p className="mt-0.5 text-[14px] font-medium text-primary break-words">{activeQuestion.label}</p>
                    {activeQuestion.details && (
                      <p className="mt-0.5 text-[13px] leading-relaxed text-secondary break-words">{activeQuestion.details}</p>
                    )}

                    {activeQuestion.options.length > 0 ? (
                      <div
                        className="mt-0.5 -mx-0.5"
                        role={activeQuestion.style === 'check' ? 'group' : 'radiogroup'}
                        aria-label={activeQuestion.label}
                      >
                        {activeQuestion.options.map((option, optionIndex) => {
                          const selectedValues = answers[activeQuestion.id] ?? [];
                          const checked = selectedValues.includes(option.value);
                          const indicator = activeQuestion.style === 'check'
                            ? (checked ? '☑' : '☐')
                            : (checked ? '◉' : '◯');
                          return (
                            <button
                              key={`${activeQuestion.id}:${option.value}`}
                              ref={(node) => { optionRefs.current[optionIndex] = node; }}
                              type="button"
                              role={activeQuestion.style === 'check' ? 'checkbox' : 'radio'}
                              aria-checked={checked}
                              aria-label={option.label}
                              aria-keyshortcuts={optionIndex < 9 ? String(optionIndex + 1) : undefined}
                              onClick={() => handleOptionSelect(activeQuestionIndex, optionIndex)}
                              onKeyDown={(event) => handleOptionKeyDown(optionIndex, event)}
                              className={cx(
                                'ui-list-row -mx-0.5 w-full items-start gap-2 px-2.5 py-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                                checked ? 'ui-list-row-selected' : 'ui-list-row-hover',
                                submitting && 'cursor-default opacity-60',
                              )}
                            >
                              <span className={cx('mt-px w-3 shrink-0 text-[12px]', checked ? 'text-accent' : 'text-dim')} aria-hidden="true">
                                {indicator}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="ui-row-title block break-words text-[14px]">{option.label}</span>
                                {option.details && (
                                  <span className="ui-row-summary block break-words text-[13px]">{option.details}</span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[13px] leading-relaxed text-secondary">
                        Send a normal message in the composer to answer this question.
                      </p>
                    )}
                  </div>
                )}

                <p className="mt-2.5 text-[11px] text-dim">
                  1-9 selects · n/p switches questions · ↑/↓ moves · Esc exits · send a normal message to skip
                </p>
              </>
            )
          ) : answerPreview ? (
            <div className="mt-2.5 space-y-1">
              <p className="text-[10px] uppercase tracking-[0.14em] text-dim/65">Your reply</p>
              <p className="text-[12px] leading-relaxed text-secondary break-words">{answerPreview}</p>
            </div>
          ) : state.status === 'superseded' ? (
            <p className="mt-2.5 text-[11px] text-dim">A newer question was asked later in the conversation.</p>
          ) : null}
        </div>
      </div>
    </SurfacePanel>
  );
}

