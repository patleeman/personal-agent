import type { ReactNode } from 'react';

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
}

const shelfAccent: Record<'mission' | 'loop', string> = {
  mission: 'border-accent/45 text-accent',
  loop: 'border-warning/55 text-warning',
};

const fieldClassName =
  'rounded-none border-0 border-b border-border-subtle bg-transparent px-0 py-1 text-[12px] text-primary outline-none transition-colors placeholder:text-dim hover:border-border-default focus:border-accent/60';

function RunShelf({ mode, label, meta, children }: { mode: 'mission' | 'loop'; label: string; meta: string; children: ReactNode }) {
  return (
    <div className={cx('mb-2 border-l-2 bg-surface/20 px-3 py-2.5', shelfAccent[mode])}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em]">{label}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-primary">{meta}</span>
      </div>
      {children}
    </div>
  );
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
}: RunModePanelProps) {
  if (mode === 'manual' || mode === 'nudge') {
    return null;
  }

  if (mode === 'mission') {
    const done = mission?.tasks.filter((task) => task.status === 'done').length ?? 0;
    const total = mission?.tasks.length ?? 0;
    const goal = mission?.goal || draftMission?.goal || 'Mission';
    const meta =
      running && mission
        ? `${goal} · ${done}/${total} tasks · ${mission.turnsUsed}/${mission.maxTurns} turns`
        : 'Set a goal; the agent manages the task list';

    return (
      <RunShelf mode="mission" label="Mission" meta={meta}>
        {running && mission ? (
          mission.tasks.length > 0 ? (
            <div className="max-h-36 overflow-y-auto pr-1">
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
            <p className="text-[12px] text-dim">Task list will appear after the agent starts the mission.</p>
          )
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              value={draftMission?.goal ?? ''}
              onChange={(event) => onDraftMissionChange?.({ goal: event.target.value, maxTurns: draftMission?.maxTurns ?? 20 })}
              rows={1}
              className={cx('w-full resize-none', fieldClassName)}
              placeholder="Goal — inferred from conversation if blank"
            />
            <label className="flex items-center gap-2 text-[11px] text-dim">
              Max turns
              <input
                type="number"
                min={1}
                max={1000}
                value={draftMission?.maxTurns ?? 20}
                onChange={(event) =>
                  onDraftMissionChange?.({ goal: draftMission?.goal ?? '', maxTurns: Math.max(1, parseInt(event.target.value, 10) || 20) })
                }
                className={cx('w-12', fieldClassName)}
              />
            </label>
          </div>
        )}
      </RunShelf>
    );
  }

  if (mode === 'loop') {
    const prompt = loop?.prompt || draftLoop?.prompt || 'Run loop iteration';
    const iterationsUsed = loop?.iterationsUsed ?? 0;
    const maxIterations = draftLoop?.maxIterations ?? loop?.maxIterations ?? 5;
    const delay = draftLoop?.delay ?? loop?.delay ?? 'After each turn';
    const meta = `${prompt} · ${iterationsUsed}/${maxIterations} iterations · ${delay}`;

    return (
      <RunShelf mode="loop" label="Loop" meta={meta}>
        <textarea
          value={draftLoop?.prompt ?? loop?.prompt ?? ''}
          onChange={(event) =>
            onDraftLoopChange?.({
              prompt: event.target.value,
              maxIterations,
              delay,
            })
          }
          rows={1}
          className={cx('mb-2 w-full resize-none', fieldClassName)}
          placeholder="Prompt to repeat each iteration"
        />
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-dim">
          <span>Run</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={maxIterations}
            onChange={(event) =>
              onDraftLoopChange?.({
                prompt: draftLoop?.prompt ?? loop?.prompt ?? '',
                maxIterations: Math.max(1, parseInt(event.target.value, 10) || 5),
                delay,
              })
            }
            className={cx('w-10 text-center', fieldClassName)}
          />
          <span>times · wait</span>
          <input
            value={delay}
            onChange={(event) =>
              onDraftLoopChange?.({
                prompt: draftLoop?.prompt ?? loop?.prompt ?? '',
                maxIterations,
                delay: event.target.value,
              })
            }
            className={cx('w-28', fieldClassName)}
          />
        </div>
      </RunShelf>
    );
  }

  return null;
}
