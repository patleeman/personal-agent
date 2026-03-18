import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAppEvents } from '../contexts';
import { useApi } from '../hooks';
import type { ConversationAutomationResponse, ConversationAutomationStep } from '../types';
import { EmptyState, ErrorState, LoadingState, Pill, SurfacePanel, ToolbarButton, cx } from './ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[128px] resize-y leading-relaxed`;

type SkillEditorState = {
  mode: 'create' | 'edit';
  kind: 'skill';
  stepId: string | null;
  label: string;
  skillName: string;
  skillArgs: string;
};

type JudgeEditorState = {
  mode: 'create' | 'edit';
  kind: 'judge';
  stepId: string | null;
  label: string;
  prompt: string;
};

type StepEditorState = SkillEditorState | JudgeEditorState;

function statusTone(summary: ReturnType<typeof buildSummary>['status']) {
  switch (summary) {
    case 'running':
    case 'armed':
      return 'accent' as const;
    case 'paused':
      return 'warning' as const;
    case 'done':
      return 'success' as const;
    default:
      return 'muted' as const;
  }
}

function stepTone(status: ConversationAutomationStep['status']) {
  switch (status) {
    case 'running':
      return 'accent' as const;
    case 'completed':
      return 'success' as const;
    case 'failed':
      return 'danger' as const;
    default:
      return 'muted' as const;
  }
}

function buildSummary(data: ConversationAutomationResponse['automation']): {
  status: 'empty' | 'running' | 'paused' | 'done' | 'armed';
  text: string;
} {
  const hasPending = data.steps.some((step) => step.status === 'pending');
  const hasRunning = data.steps.some((step) => step.status === 'running');

  if (hasRunning) {
    return { status: 'running', text: 'Running' };
  }

  if (data.steps.length === 0) {
    return { status: 'empty', text: 'Empty' };
  }

  if (data.paused && hasPending) {
    return { status: 'paused', text: 'Paused' };
  }

  if (!data.paused && hasPending) {
    return { status: 'armed', text: 'Armed' };
  }

  return { status: 'done', text: 'Done' };
}

function buildEmptyAutomation(conversationId: string): ConversationAutomationResponse['automation'] {
  return {
    conversationId,
    paused: true,
    activeStepId: null,
    updatedAt: '',
    steps: [],
  };
}

function describeStep(step: ConversationAutomationStep): string {
  if (step.kind === 'judge') {
    if (step.status === 'running') {
      return 'Evaluating the sanitized user/assistant thread.';
    }

    return 'Judge gate using the dedicated automation judge model.';
  }

  if (step.status === 'running') {
    return 'Waiting for the automated follow-up turn to finish.';
  }

  if (step.skillArgs) {
    return `Queues /skill:${step.skillName} ${step.skillArgs}`;
  }

  return `Queues /skill:${step.skillName}`;
}

function isPendingLike(status: ConversationAutomationStep['status']) {
  return status === 'pending' || status === 'failed' || status === 'completed';
}

function buildSkillEditorState(
  skills: ConversationAutomationResponse['skills'],
  step?: Extract<ConversationAutomationStep, { kind: 'skill' }>,
): SkillEditorState {
  return {
    mode: step ? 'edit' : 'create',
    kind: 'skill',
    stepId: step?.id ?? null,
    label: step && step.label !== step.skillName ? step.label : '',
    skillName: step?.skillName ?? skills[0]?.name ?? '',
    skillArgs: step?.skillArgs ?? '',
  };
}

function buildJudgeEditorState(
  step?: Extract<ConversationAutomationStep, { kind: 'judge' }>,
): JudgeEditorState {
  return {
    mode: step ? 'edit' : 'create',
    kind: 'judge',
    stepId: step?.id ?? null,
    label: step && step.label !== 'Judge gate' ? step.label : '',
    prompt: step?.prompt ?? '',
  };
}

function buildEditorTitle(state: StepEditorState | null): string {
  if (!state) {
    return 'Queue editor';
  }

  if (state.kind === 'skill') {
    return state.mode === 'edit' ? 'Edit skill step' : 'New skill step';
  }

  return state.mode === 'edit' ? 'Edit judge gate' : 'New judge gate';
}

export function ConversationAutomationPanel({ conversationId }: { conversationId: string }) {
  const { versions } = useAppEvents();
  const fetcher = useCallback(() => api.conversationAutomation(conversationId), [conversationId]);
  const {
    data,
    loading,
    refreshing,
    error,
    refetch,
  } = useApi(fetcher, conversationId);
  const [changingPaused, setChangingPaused] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyStepId, setBusyStepId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorState, setEditorState] = useState<StepEditorState | null>(null);
  const [savingStep, setSavingStep] = useState(false);

  useEffect(() => {
    void refetch({ resetLoading: false });
  }, [conversationId, refetch, versions.sessions]);

  useEffect(() => {
    setEditorOpen(false);
    setEditorState(null);
    setActionError(null);
    setBusyStepId(null);
    setSavingStep(false);
    setChangingPaused(false);
  }, [conversationId]);

  useEffect(() => {
    if (!data || !editorState || editorState.kind !== 'skill' || data.skills.length === 0) {
      return;
    }

    const skillStillExists = data.skills.some((skill) => skill.name === editorState.skillName);
    if (skillStillExists) {
      return;
    }

    setEditorState({
      ...editorState,
      skillName: data.skills[0]!.name,
    });
  }, [data, editorState]);

  useEffect(() => {
    if (!data || !editorState || editorState.mode !== 'edit' || !editorState.stepId) {
      return;
    }

    const stepStillExists = data.automation.steps.some((step) => step.id === editorState.stepId && step.kind === editorState.kind);
    if (!stepStillExists) {
      setEditorState(null);
    }
  }, [data, editorState]);

  const automation = data?.automation ?? buildEmptyAutomation(conversationId);
  const summary = useMemo(() => buildSummary(automation), [automation]);
  const hasPending = automation.steps.some((step) => step.status === 'pending');

  async function refreshWithResult<T>(request: Promise<T>) {
    setActionError(null);
    await request;
    await refetch({ resetLoading: false });
  }

  function openQueueEditor() {
    setEditorOpen(true);
    setActionError(null);
  }

  function closeQueueEditor() {
    setEditorOpen(false);
    setEditorState(null);
  }

  function openNewSkillEditor() {
    if (!data) {
      return;
    }

    setEditorOpen(true);
    setEditorState(buildSkillEditorState(data.skills));
    setActionError(null);
  }

  function openNewJudgeEditor() {
    setEditorOpen(true);
    setEditorState(buildJudgeEditorState());
    setActionError(null);
  }

  function openStepEditor(step: ConversationAutomationStep) {
    if (!data) {
      return;
    }

    setEditorOpen(true);
    setEditorState(step.kind === 'skill'
      ? buildSkillEditorState(data.skills, step)
      : buildJudgeEditorState(step));
    setActionError(null);
  }

  async function handleTogglePaused() {
    if (!data || changingPaused) {
      return;
    }

    setChangingPaused(true);
    try {
      await refreshWithResult(api.updateConversationAutomation(conversationId, {
        paused: !data.automation.paused,
      }));
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setChangingPaused(false);
    }
  }

  async function handleSubmitEditor() {
    if (!data || !editorState || savingStep) {
      return;
    }

    setSavingStep(true);
    try {
      if (editorState.kind === 'skill') {
        const skillName = editorState.skillName.trim();
        if (!skillName) {
          throw new Error('Pick a skill before saving this step.');
        }

        if (editorState.mode === 'edit' && editorState.stepId) {
          await refreshWithResult(api.updateConversationAutomationStep(conversationId, editorState.stepId, {
            label: editorState.label.trim() || undefined,
            skillName,
            skillArgs: editorState.skillArgs.trim() || undefined,
          }));
        } else {
          await refreshWithResult(api.addConversationAutomationStep(conversationId, {
            kind: 'skill',
            label: editorState.label.trim() || undefined,
            skillName,
            skillArgs: editorState.skillArgs.trim() || undefined,
          }));
        }
      } else {
        const prompt = editorState.prompt.trim();
        if (!prompt) {
          throw new Error('Judge prompt required.');
        }

        if (editorState.mode === 'edit' && editorState.stepId) {
          await refreshWithResult(api.updateConversationAutomationStep(conversationId, editorState.stepId, {
            label: editorState.label.trim() || undefined,
            prompt,
          }));
        } else {
          await refreshWithResult(api.addConversationAutomationStep(conversationId, {
            kind: 'judge',
            label: editorState.label.trim() || undefined,
            prompt,
          }));
        }
      }

      setEditorState(null);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSavingStep(false);
    }
  }

  async function handleMove(stepId: string, direction: 'up' | 'down') {
    setBusyStepId(stepId);
    try {
      await refreshWithResult(api.moveConversationAutomationStep(conversationId, stepId, direction));
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyStepId(null);
    }
  }

  async function handleReset(stepId: string, resume = false) {
    setBusyStepId(stepId);
    try {
      await refreshWithResult(api.resetConversationAutomationStep(conversationId, stepId, resume));
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyStepId(null);
    }
  }

  async function handleDelete(stepId: string) {
    setBusyStepId(stepId);
    try {
      await refreshWithResult(api.deleteConversationAutomationStep(conversationId, stepId));
      setEditorState((current) => current?.stepId === stepId ? null : current);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyStepId(null);
    }
  }

  if (loading && !data) {
    return <LoadingState label="Loading automation…" className="px-3 py-3" />;
  }

  if (error && !data) {
    return <ErrorState message={error} className="px-3 py-3" />;
  }

  if (!data) {
    return null;
  }

  const selectedSkill = editorState?.kind === 'skill'
    ? data.skills.find((skill) => skill.name === editorState.skillName) ?? null
    : null;

  return (
    <>
      <SurfacePanel muted className="px-3 py-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Pill tone={statusTone(summary.status)}>{summary.text.toLowerCase()}</Pill>
              <span className="text-[11px] text-dim">
                {automation.steps.length === 1 ? '1 step' : `${automation.steps.length} steps`}
              </span>
              {refreshing && <span className="text-[11px] text-dim">refreshing…</span>}
            </div>
            <p className="text-[12px] text-secondary leading-relaxed">
              Configure this queue in a separate editor window. Skills still run as same-thread follow-ups, with judge gates between them when needed.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ToolbarButton onClick={openQueueEditor} className="text-accent">
              {automation.steps.length === 0 ? 'Set up' : 'Open editor'}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => { void handleTogglePaused(); }}
              disabled={changingPaused || (automation.steps.length === 0 && automation.paused)}
              className={!automation.paused ? 'text-warning' : 'text-accent'}
            >
              {changingPaused
                ? 'Saving…'
                : automation.paused
                  ? (hasPending ? 'Arm queue' : 'Arm')
                  : 'Pause'}
            </ToolbarButton>
          </div>
        </div>

        {!data.live && !automation.paused && (
          <p className="text-[11px] text-warning">Resume this conversation to continue the armed queue.</p>
        )}

        {automation.steps.length === 0 ? (
          <p className="text-[12px] text-dim">No queued steps yet. Use the editor window to add skill steps and judge gates.</p>
        ) : (
          <div className="space-y-0">
            {automation.steps.map((step, index) => (
              <button
                key={step.id}
                type="button"
                onClick={() => openStepEditor(step)}
                className={cx(
                  'w-full py-2 text-left transition-colors hover:text-primary',
                  index > 0 && 'border-t border-border-subtle',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] uppercase tracking-[0.12em] text-dim">{step.kind}</span>
                      <Pill tone={stepTone(step.status)}>{step.status}</Pill>
                      {automation.activeStepId === step.id && <span className="text-[10px] uppercase tracking-[0.12em] text-accent">active</span>}
                    </div>
                    <p className="text-[13px] font-medium text-primary break-words">{step.label}</p>
                    <p className="text-[11px] text-secondary break-words">{describeStep(step)}</p>
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-dim shrink-0">edit</span>
                </div>
              </button>
            ))}
          </div>
        )}

        <p className="text-[11px] text-dim">
          Judge defaults live in <Link to="/settings" className="text-accent hover:underline">Settings</Link> · {data.judge.effectiveModel}
        </p>

        {actionError && !editorOpen && <p className="text-[11px] text-danger">{actionError}</p>}
      </SurfacePanel>

      {editorOpen && (
        <div
          className="ui-overlay-backdrop"
          style={{ background: 'rgb(0 0 0 / 0.55)', backdropFilter: 'blur(2px)' }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeQueueEditor();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Conversation automation editor"
            className="ui-dialog-shell"
            style={{ width: 'min(72rem, calc(100vw - 2rem))', height: 'min(48rem, calc(100vh - 2rem))', maxHeight: 'calc(100vh - 2rem)' }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-4 py-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="ui-section-label">Conversation automation</p>
                  <Pill tone={statusTone(summary.status)}>{summary.text.toLowerCase()}</Pill>
                  <span className="text-[11px] text-dim">
                    {automation.steps.length === 1 ? '1 step' : `${automation.steps.length} steps`}
                  </span>
                  {refreshing && <span className="text-[11px] text-dim">refreshing…</span>}
                </div>
                <p className="text-[12px] text-secondary leading-relaxed">
                  Keep the sidebar lightweight and manage the queue here instead. Skill steps enqueue <span className="font-mono">/skill:name</span> follow-ups in the same conversation; judge gates evaluate a sanitized user/assistant thread.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ToolbarButton
                  onClick={() => { void handleTogglePaused(); }}
                  disabled={changingPaused || (automation.steps.length === 0 && automation.paused)}
                  className={!automation.paused ? 'text-warning' : 'text-accent'}
                >
                  {changingPaused
                    ? 'Saving…'
                    : automation.paused
                      ? (hasPending ? 'Arm queue' : 'Arm')
                      : 'Pause'}
                </ToolbarButton>
                <ToolbarButton onClick={closeQueueEditor}>Close</ToolbarButton>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden md:grid md:grid-cols-[22rem_minmax(0,1fr)]">
              <div className="min-h-0 overflow-y-auto border-b border-border-subtle md:border-b-0 md:border-r md:border-border-subtle">
                <div className="space-y-3 px-4 py-4">
                  <div className="flex flex-wrap gap-2">
                    <ToolbarButton onClick={openNewSkillEditor} disabled={data.skills.length === 0} className="text-accent">
                      + skill step
                    </ToolbarButton>
                    <ToolbarButton onClick={openNewJudgeEditor} className="text-accent">
                      + judge gate
                    </ToolbarButton>
                  </div>

                  {!data.live && !automation.paused && (
                    <p className="text-[11px] text-warning">Resume this conversation to continue the armed queue.</p>
                  )}
                </div>

                {automation.steps.length === 0 ? (
                  <EmptyState
                    className="px-4 pb-6"
                    title="No queued steps"
                    body="Add a skill step or judge gate from this editor, then arm the queue when you’re ready."
                  />
                ) : (
                  <div className="border-t border-border-subtle">
                    {automation.steps.map((step, index) => {
                      const busy = busyStepId === step.id;
                      const canMoveUp = index > 0 && step.status !== 'running';
                      const canMoveDown = index < automation.steps.length - 1 && step.status !== 'running';
                      const canReset = isPendingLike(step.status);
                      const selected = editorState?.mode === 'edit' && editorState.stepId === step.id;

                      return (
                        <div key={step.id} className={cx('border-t border-border-subtle first:border-t-0', selected && 'bg-accent/8')}>
                          <div className="flex items-start gap-3 px-4 py-3">
                            <button
                              type="button"
                              onClick={() => openStepEditor(step)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] uppercase tracking-[0.12em] text-dim">{step.kind}</span>
                                <Pill tone={stepTone(step.status)}>{step.status}</Pill>
                                {automation.activeStepId === step.id && <span className="text-[10px] uppercase tracking-[0.12em] text-accent">active</span>}
                              </div>
                              <p className="mt-1 text-[13px] font-medium text-primary break-words">{step.label}</p>
                              <p className="mt-1 text-[11px] text-secondary break-words">{describeStep(step)}</p>
                              {step.resultReason && (
                                <p className={cx('mt-1 text-[11px] break-words', step.status === 'failed' ? 'text-danger' : 'text-dim')}>
                                  {step.resultReason}
                                  {typeof step.resultConfidence === 'number' ? ` · confidence ${Math.round(step.resultConfidence * 100)}%` : ''}
                                </p>
                              )}
                            </button>

                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <ToolbarButton onClick={() => { void handleMove(step.id, 'up'); }} disabled={!canMoveUp || busy}>↑</ToolbarButton>
                              <ToolbarButton onClick={() => { void handleMove(step.id, 'down'); }} disabled={!canMoveDown || busy}>↓</ToolbarButton>
                              <ToolbarButton onClick={() => { void handleDelete(step.id); }} disabled={step.status === 'running' || busy} className="text-danger">
                                del
                              </ToolbarButton>
                              {canReset && (
                                <ToolbarButton onClick={() => { void handleReset(step.id, true); }} disabled={busy} className="text-accent">
                                  rerun
                                </ToolbarButton>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="min-h-0 overflow-y-auto px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="ui-section-label">{buildEditorTitle(editorState)}</p>
                    <p className="text-[12px] text-secondary leading-relaxed">
                      Judge gates use the dedicated automation judge defaults from <Link to="/settings" className="text-accent hover:underline">Settings</Link> · {data.judge.effectiveModel}
                    </p>
                  </div>
                  {editorState && (
                    <ToolbarButton onClick={() => setEditorState(null)} disabled={savingStep}>
                      Cancel
                    </ToolbarButton>
                  )}
                </div>

                {!editorState ? (
                  <EmptyState
                    className="mt-6"
                    title="Pick a step to edit"
                    body="Select an existing queue step from the left, or start a new skill step or judge gate here."
                    action={(
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <ToolbarButton onClick={openNewSkillEditor} disabled={data.skills.length === 0} className="text-accent">
                          + skill step
                        </ToolbarButton>
                        <ToolbarButton onClick={openNewJudgeEditor} className="text-accent">
                          + judge gate
                        </ToolbarButton>
                      </div>
                    )}
                  />
                ) : editorState.kind === 'skill' ? (
                  <div className="mt-5 space-y-4">
                    <div className="space-y-1.5">
                      <label className="ui-section-label" htmlFor="conversation-automation-skill-label">Label</label>
                      <input
                        id="conversation-automation-skill-label"
                        value={editorState.label}
                        onChange={(event) => setEditorState({ ...editorState, label: event.target.value })}
                        className={INPUT_CLASS}
                        placeholder="Optional label (defaults to the skill name)"
                        disabled={savingStep}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="ui-section-label" htmlFor="conversation-automation-skill-name">Skill</label>
                      <select
                        id="conversation-automation-skill-name"
                        value={editorState.skillName}
                        onChange={(event) => setEditorState({ ...editorState, skillName: event.target.value })}
                        className={INPUT_CLASS}
                        disabled={savingStep || data.skills.length === 0}
                      >
                        {data.skills.map((skill) => (
                          <option key={skill.name} value={skill.name}>{skill.name} · {skill.source}</option>
                        ))}
                      </select>
                      <p className="text-[11px] text-dim break-words">
                        {selectedSkill?.description ?? 'No description available.'}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="ui-section-label" htmlFor="conversation-automation-skill-args">Args</label>
                      <input
                        id="conversation-automation-skill-args"
                        value={editorState.skillArgs}
                        onChange={(event) => setEditorState({ ...editorState, skillArgs: event.target.value })}
                        className={INPUT_CLASS}
                        placeholder="Optional one-line args appended after /skill:name"
                        disabled={savingStep}
                      />
                      <p className="text-[11px] text-dim">
                        This still queues a normal <span className="font-mono">/skill:{editorState.skillName || 'name'}</span> follow-up in the same conversation.
                      </p>
                    </div>

                    {editorState.mode === 'edit' && (
                      <p className="text-[11px] text-dim">
                        Saving resets this step and any later steps to pending so the edited configuration can run again.
                      </p>
                    )}

                    <div className="flex items-center gap-2">
                      <ToolbarButton
                        onClick={() => { void handleSubmitEditor(); }}
                        disabled={savingStep || !editorState.skillName.trim()}
                        className="text-accent"
                      >
                        {savingStep
                          ? 'Saving…'
                          : editorState.mode === 'edit'
                            ? 'Save step'
                            : 'Add step'}
                      </ToolbarButton>
                      <button
                        type="button"
                        onClick={() => setEditorState(null)}
                        className="text-[12px] text-secondary transition-colors hover:text-primary"
                        disabled={savingStep}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 space-y-4">
                    <div className="space-y-1.5">
                      <label className="ui-section-label" htmlFor="conversation-automation-judge-label">Label</label>
                      <input
                        id="conversation-automation-judge-label"
                        value={editorState.label}
                        onChange={(event) => setEditorState({ ...editorState, label: event.target.value })}
                        className={INPUT_CLASS}
                        placeholder="Optional label (defaults to Judge gate)"
                        disabled={savingStep}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="ui-section-label" htmlFor="conversation-automation-judge-prompt">Judge prompt</label>
                      <textarea
                        id="conversation-automation-judge-prompt"
                        value={editorState.prompt}
                        onChange={(event) => setEditorState({ ...editorState, prompt: event.target.value })}
                        className={TEXTAREA_CLASS}
                        placeholder="Decide whether the current conversation is ready for the next step."
                        disabled={savingStep}
                      />
                      <p className="text-[11px] text-dim">
                        Judge steps only see the visible user/assistant thread. Tool calls, tool output, and thinking are stripped before evaluation.
                      </p>
                    </div>

                    {editorState.mode === 'edit' && (
                      <p className="text-[11px] text-dim">
                        Saving resets this gate and any later steps to pending so the edited criteria can run again.
                      </p>
                    )}

                    <div className="flex items-center gap-2">
                      <ToolbarButton
                        onClick={() => { void handleSubmitEditor(); }}
                        disabled={savingStep || !editorState.prompt.trim()}
                        className="text-accent"
                      >
                        {savingStep
                          ? 'Saving…'
                          : editorState.mode === 'edit'
                            ? 'Save gate'
                            : 'Add gate'}
                      </ToolbarButton>
                      <button
                        type="button"
                        onClick={() => setEditorState(null)}
                        className="text-[12px] text-secondary transition-colors hover:text-primary"
                        disabled={savingStep}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {actionError && <p className="mt-4 text-[11px] text-danger">{actionError}</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
