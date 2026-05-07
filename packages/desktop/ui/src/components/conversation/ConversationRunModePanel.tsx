import { useEffect, useRef, useState } from 'react';

import type { LoopState, MissionState, RunMode } from '../../shared/types';
import { cx } from '../ui';

export interface DraftMissionConfig {
  goal: string;
  maxTurns: number;
}

export interface DraftLoopConfig {
  prompt: string;
  maxIterations: number;
  delay: string;
}

export interface RunModePanelProps {
  mode: RunMode;
  running: boolean;
  mission?: MissionState | null;
  loop?: LoopState | null;
  draftMission?: DraftMissionConfig;
  draftLoop?: DraftLoopConfig;
  onDraftMissionChange?: (draft: DraftMissionConfig) => void;
  onDraftLoopChange?: (draft: DraftLoopConfig) => void;
  onAddMissionTask?: (description: string) => void;
}

/**
 * Local-state input that only commits to the parent on blur.
 * Prevents expensive parent re-renders on every keystroke.
 */
function LazyInput({
  value,
  onChange,
  onBlur,
  className,
  'aria-label': ariaLabel,
  placeholder,
  inputMode,
  pattern,
}: {
  value: string;
  onChange?: (value: string) => void;
  onBlur?: (value: string) => void;
  className?: string;
  'aria-label'?: string;
  placeholder?: string;
  inputMode?: 'text' | 'numeric';
  pattern?: string;
}) {
  const [local, setLocal] = useState(value);
  const committedRef = useRef(value);

  // Sync from props when external value changes (not from our own blur)
  useEffect(() => {
    if (committedRef.current !== value) {
      committedRef.current = value;
      setLocal(value);
    }
  }, [value]);

  return (
    <input
      aria-label={ariaLabel}
      value={local}
      inputMode={inputMode}
      pattern={pattern}
      placeholder={placeholder}
      onChange={(e) => {
        setLocal(e.target.value);
        onChange?.(e.target.value);
      }}
      onBlur={() => {
        if (local !== committedRef.current) {
          committedRef.current = local;
          onBlur?.(local);
        }
      }}
      className={className}
    />
  );
}

const modeTextClassName: Record<'mission' | 'loop', string> = {
  mission: 'text-accent',
  loop: 'text-warning',
};

const fieldClassName =
  'min-w-0 rounded-none border-0 border-b border-border-subtle bg-transparent px-0 py-0.5 text-[12px] font-medium text-primary outline-none transition-colors placeholder:text-dim hover:border-border-default focus:border-accent/60';

const compactNumberClassName = cx('w-10 text-center', fieldClassName);
const loopDelayOptions = ['After each turn', '30s', '1m', '5m', '10m'];

function ModeLabel({ mode, children }: { mode: 'mission' | 'loop'; children: string }) {
  return <span className={cx('shrink-0 text-[10px] font-bold uppercase tracking-[0.08em]', modeTextClassName[mode])}>{children}</span>;
}

export function ConversationRunModePanel({
  mode,
  running,
  mission,
  loop,
  draftMission,
  draftLoop,
  onDraftMissionChange,
  onDraftLoopChange,
  onAddMissionTask,
}: RunModePanelProps) {
  const [missionTaskDraft, setMissionTaskDraft] = useState('');
  if (mode === 'manual' || mode === 'nudge') {
    return null;
  }

  if (mode === 'mission') {
    const done = mission?.tasks.filter((task) => task.status === 'done').length ?? 0;
    const total = mission?.tasks.length ?? 0;
    const goal = draftMission?.goal ?? mission?.goal ?? '';
    const maxTurns = mission?.maxTurns ?? draftMission?.maxTurns ?? 20;
    const turnsUsed = mission?.turnsUsed ?? 0;

    const commitMissionGoal = (value: string) => {
      onDraftMissionChange?.({ goal: value, maxTurns });
    };
    const commitMissionMaxTurns = (value: string) => {
      const num = Math.max(1, parseInt(value, 10) || 20);
      onDraftMissionChange?.({
        goal: draftMission?.goal ?? mission?.goal ?? '',
        maxTurns: num,
      });
    };

    return (
      <div className="border-b border-border-subtle/60 bg-surface/20 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-dim">
          <ModeLabel mode="mission">Mission</ModeLabel>
          <span className="shrink-0">Goal</span>
          <LazyInput
            aria-label="Mission goal"
            value={goal}
            onBlur={commitMissionGoal}
            className={cx('min-w-[12rem] flex-1', fieldClassName)}
            placeholder="Infer from conversation if blank"
          />
          <span className="shrink-0">
            Tasks {done}/{total}
          </span>
          <span className="shrink-0">Turns</span>
          <span className="shrink-0 text-primary">{turnsUsed}</span>
          <span className="shrink-0">/</span>
          <LazyInput
            aria-label="Mission max turns"
            value={String(maxTurns)}
            onBlur={commitMissionMaxTurns}
            inputMode="numeric"
            pattern="[0-9]*"
            className={compactNumberClassName}
          />
        </div>
        {running && mission ? (
          <>
            {mission.tasks.length > 0 ? (
              <div className="mt-1.5 max-h-36 overflow-y-auto pr-1">
                {mission.tasks.map((task) => (
                  <div key={task.id} className={cx('flex items-center gap-2 py-1 text-[12px]', task.status === 'done' && 'opacity-55')}>
                    <span
                      className={cx(
                        'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border text-[8px]',
                        task.status === 'done' ? 'border-success/60 bg-success/10 text-success' : 'border-border-default text-transparent',
                      )}
                    >
                      {task.status === 'done' ? '✓' : ''}
                    </span>
                    <span className={cx('min-w-0 flex-1 truncate', task.status === 'done' && 'text-dim line-through')}>
                      {task.description}
                    </span>
                    {task.status !== 'pending' && task.status !== 'done' ? (
                      <span className="shrink-0 text-[10px] text-dim">{task.status}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1.5 text-[12px] text-dim">Task list will appear after the agent starts the mission.</p>
            )}
            {onAddMissionTask ? (
              <form
                className="mt-1.5 flex items-center gap-2 text-[12px]"
                onSubmit={(event) => {
                  event.preventDefault();
                  const description = missionTaskDraft.trim();
                  if (!description) {
                    return;
                  }
                  onAddMissionTask(description);
                  setMissionTaskDraft('');
                }}
              >
                <input
                  aria-label="Add mission task"
                  value={missionTaskDraft}
                  onChange={(event) => setMissionTaskDraft(event.target.value)}
                  className={cx('min-w-[12rem] flex-1', fieldClassName)}
                  placeholder="Add task"
                />
                <button
                  type="submit"
                  className="shrink-0 text-[11px] font-semibold text-accent transition-colors hover:text-accent/80 disabled:text-dim"
                  disabled={!missionTaskDraft.trim()}
                >
                  Add
                </button>
              </form>
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  if (mode === 'loop') {
    const prompt = draftLoop?.prompt ?? loop?.prompt ?? '';
    const iterationsUsed = loop?.iterationsUsed ?? 0;
    const maxIterations = draftLoop?.maxIterations ?? loop?.maxIterations ?? 5;
    const delay = draftLoop?.delay ?? loop?.delay ?? 'After each turn';
    const delayOptions = loopDelayOptions.includes(delay) ? loopDelayOptions : [delay, ...loopDelayOptions];

    const commitLoopPrompt = (value: string) => {
      onDraftLoopChange?.({ prompt: value, maxIterations, delay });
    };
    const commitLoopMaxIterations = (value: string) => {
      const num = Math.max(1, parseInt(value, 10) || 5);
      onDraftLoopChange?.({
        prompt: draftLoop?.prompt ?? loop?.prompt ?? '',
        maxIterations: num,
        delay,
      });
    };

    return (
      <div className="border-b border-border-subtle/60 bg-surface/20 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-dim">
          <ModeLabel mode="loop">Loop</ModeLabel>
          <LazyInput
            aria-label="Loop prompt"
            value={prompt}
            onBlur={commitLoopPrompt}
            className={cx('min-w-[14rem] flex-1', fieldClassName)}
            placeholder="Prompt to repeat each iteration"
          />
          <span className="shrink-0">Run</span>
          <span className="shrink-0 text-primary">{iterationsUsed}</span>
          <span className="shrink-0">/</span>
          <LazyInput
            aria-label="Loop max iterations"
            value={String(maxIterations)}
            onBlur={commitLoopMaxIterations}
            inputMode="numeric"
            pattern="[0-9]*"
            className={compactNumberClassName}
          />
          <span className="shrink-0">times · wait</span>
          <select
            value={delay}
            onChange={(event) =>
              onDraftLoopChange?.({
                prompt: draftLoop?.prompt ?? loop?.prompt ?? '',
                maxIterations,
                delay: event.target.value,
              })
            }
            aria-label="Loop delay"
            className={cx('w-32 appearance-none', fieldClassName)}
          >
            {delayOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return null;
}
