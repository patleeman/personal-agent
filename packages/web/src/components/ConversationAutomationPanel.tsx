import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAppEvents } from '../contexts';
import { useApi } from '../hooks';
import type { ConversationAutomationResponse, ConversationAutomationStep } from '../types';
import { ErrorState, LoadingState, Pill, SurfacePanel, ToolbarButton, cx } from './ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[92px] resize-y leading-relaxed`;

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
  const [activeForm, setActiveForm] = useState<null | 'skill' | 'judge'>(null);
  const [selectedSkillName, setSelectedSkillName] = useState('');
  const [skillArgs, setSkillArgs] = useState('');
  const [judgeLabel, setJudgeLabel] = useState('');
  const [judgePrompt, setJudgePrompt] = useState('');
  const [busyStepId, setBusyStepId] = useState<string | null>(null);
  const [addingStep, setAddingStep] = useState(false);

  useEffect(() => {
    void refetch({ resetLoading: false });
  }, [conversationId, refetch, versions.sessions]);

  useEffect(() => {
    if (!data?.skills.length) {
      setSelectedSkillName('');
      return;
    }

    const skillStillExists = data.skills.some((skill) => skill.name === selectedSkillName);
    if (!skillStillExists) {
      setSelectedSkillName(data.skills[0]!.name);
    }
  }, [data?.skills, selectedSkillName]);

  const summary = useMemo(() => buildSummary(data?.automation ?? {
    conversationId,
    paused: true,
    activeStepId: null,
    updatedAt: '',
    steps: [],
  }), [conversationId, data?.automation]);
  const hasPending = Boolean(data?.automation.steps.some((step) => step.status === 'pending'));

  async function refreshWithResult<T>(request: Promise<T>) {
    setActionError(null);
    await request;
    await refetch({ resetLoading: false });
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

  async function handleAddSkillStep() {
    if (!selectedSkillName || addingStep) {
      return;
    }

    setAddingStep(true);
    try {
      await refreshWithResult(api.addConversationAutomationStep(conversationId, {
        kind: 'skill',
        skillName: selectedSkillName,
        skillArgs: skillArgs.trim() || undefined,
      }));
      setSkillArgs('');
      setActiveForm(null);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAddingStep(false);
    }
  }

  async function handleAddJudgeStep() {
    if (!judgePrompt.trim() || addingStep) {
      return;
    }

    setAddingStep(true);
    try {
      await refreshWithResult(api.addConversationAutomationStep(conversationId, {
        kind: 'judge',
        label: judgeLabel.trim() || undefined,
        prompt: judgePrompt.trim(),
      }));
      setJudgeLabel('');
      setJudgePrompt('');
      setActiveForm(null);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAddingStep(false);
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

  return (
    <SurfacePanel muted className="px-3 py-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone={statusTone(summary.status)}>{summary.text.toLowerCase()}</Pill>
            {refreshing && <span className="text-[11px] text-dim">refreshing…</span>}
          </div>
          <p className="text-[12px] text-secondary leading-relaxed">
            Queue skills and judge gates for this conversation. Skills run as same-thread follow-ups. Semantic checks between skills should use judge steps.
          </p>
        </div>
        <ToolbarButton onClick={() => { void handleTogglePaused(); }} disabled={changingPaused || (data.automation.steps.length === 0 && data.automation.paused)} className={!data.automation.paused ? 'text-warning' : 'text-accent'}>
          {changingPaused
            ? 'Saving…'
            : data.automation.paused
              ? (hasPending ? 'Arm queue' : 'Arm')
              : 'Pause'}
        </ToolbarButton>
      </div>

      {!data.live && !data.automation.paused && (
        <p className="text-[11px] text-warning">Resume this conversation to continue the armed queue.</p>
      )}

      {data.automation.steps.length === 0 ? (
        <p className="text-[12px] text-dim">No queued steps yet. Add a skill step or a judge gate, then arm the queue when you’re ready.</p>
      ) : (
        <div className="space-y-0">
          {data.automation.steps.map((step, index) => {
            const busy = busyStepId === step.id;
            const canMoveUp = index > 0 && step.status !== 'running';
            const canMoveDown = index < (data.automation.steps.length - 1) && step.status !== 'running';
            const canReset = isPendingLike(step.status);
            return (
              <div key={step.id} className={cx('py-3', index > 0 && 'border-t border-border-subtle')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] uppercase tracking-[0.12em] text-dim">{step.kind}</span>
                      <Pill tone={stepTone(step.status)}>{step.status}</Pill>
                      {data.automation.activeStepId === step.id && <span className="text-[10px] uppercase tracking-[0.12em] text-accent">active</span>}
                    </div>
                    <p className="text-[13px] font-medium text-primary break-words">{step.label}</p>
                    <p className="text-[11px] text-secondary break-words">{describeStep(step)}</p>
                    {step.resultReason && (
                      <p className={cx('text-[11px] break-words', step.status === 'failed' ? 'text-danger' : 'text-dim')}>
                        {step.resultReason}
                        {typeof step.resultConfidence === 'number' ? ` · confidence ${Math.round(step.resultConfidence * 100)}%` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <ToolbarButton onClick={() => { void handleMove(step.id, 'up'); }} disabled={!canMoveUp || busy}>↑</ToolbarButton>
                    <ToolbarButton onClick={() => { void handleMove(step.id, 'down'); }} disabled={!canMoveDown || busy}>↓</ToolbarButton>
                    <ToolbarButton onClick={() => { void handleDelete(step.id); }} disabled={step.status === 'running' || busy} className="text-danger">del</ToolbarButton>
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

      <div className="border-t border-border-subtle pt-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <ToolbarButton onClick={() => setActiveForm((current) => current === 'skill' ? null : 'skill')} className={activeForm === 'skill' ? 'text-accent' : undefined}>
            + skill step
          </ToolbarButton>
          <ToolbarButton onClick={() => setActiveForm((current) => current === 'judge' ? null : 'judge')} className={activeForm === 'judge' ? 'text-accent' : undefined}>
            + judge gate
          </ToolbarButton>
        </div>

        {activeForm === 'skill' && (
          <div className="space-y-2">
            <select
              value={selectedSkillName}
              onChange={(event) => setSelectedSkillName(event.target.value)}
              className={INPUT_CLASS}
              disabled={addingStep || data.skills.length === 0}
            >
              {data.skills.map((skill) => (
                <option key={skill.name} value={skill.name}>{skill.name} · {skill.source}</option>
              ))}
            </select>
            <input
              value={skillArgs}
              onChange={(event) => setSkillArgs(event.target.value)}
              className={INPUT_CLASS}
              placeholder="Optional one-line args appended after /skill:name"
              disabled={addingStep}
            />
            {selectedSkillName && (
              <p className="text-[11px] text-dim">
                {data.skills.find((skill) => skill.name === selectedSkillName)?.description ?? 'No description available.'}
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-dim">This queues a normal <span className="font-mono">/skill:{selectedSkillName || 'name'}</span> follow-up in the same conversation.</p>
              <ToolbarButton onClick={() => { void handleAddSkillStep(); }} disabled={addingStep || !selectedSkillName} className="text-accent">
                {addingStep ? 'Adding…' : 'Add step'}
              </ToolbarButton>
            </div>
          </div>
        )}

        {activeForm === 'judge' && (
          <div className="space-y-2">
            <input
              value={judgeLabel}
              onChange={(event) => setJudgeLabel(event.target.value)}
              className={INPUT_CLASS}
              placeholder="Optional label (defaults to Judge gate)"
              disabled={addingStep}
            />
            <textarea
              value={judgePrompt}
              onChange={(event) => setJudgePrompt(event.target.value)}
              className={TEXTAREA_CLASS}
              placeholder="Decide whether the current conversation is ready for the next step."
              disabled={addingStep}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-dim">
                Uses judge defaults from <Link to="/settings" className="text-accent hover:underline">Settings</Link> · {data.judge.effectiveModel}
              </p>
              <ToolbarButton onClick={() => { void handleAddJudgeStep(); }} disabled={addingStep || !judgePrompt.trim()} className="text-accent">
                {addingStep ? 'Adding…' : 'Add gate'}
              </ToolbarButton>
            </div>
          </div>
        )}
      </div>

      {actionError && <p className="text-[11px] text-danger">{actionError}</p>}
    </SurfacePanel>
  );
}
