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
    return (
      <div className="mb-2 px-0 py-1">
        <div className="mb-1.5 flex items-center justify-between px-0.5">
          <strong className="text-[11px] font-semibold text-secondary">Mission</strong>
          {running && mission ? (
            <span className="text-[10px] text-dim">
              {mission.tasks.filter((t) => t.status === 'done').length}/{mission.tasks.length} tasks · {mission.turnsUsed}/
              {mission.maxTurns} turns
            </span>
          ) : (
            <span className="text-[10px] text-dim">AI proposes task list, you can edit anytime</span>
          )}
        </div>
        {running && mission ? (
          <div className="max-h-[120px] overflow-y-auto">
            {mission.tasks.map((task) => (
              <div
                key={task.id}
                className={cx(
                  'flex items-center gap-2 rounded px-2 py-1 text-[12px]',
                  task.status === 'done' ? 'opacity-50' : 'hover:bg-surface/45',
                )}
              >
                <span
                  className={cx(
                    'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border text-[8px]',
                    task.status === 'done' ? 'border-success/60 bg-success/10 text-success' : 'border-border-default text-transparent',
                  )}
                >
                  {task.status === 'done' ? '✓' : ''}
                </span>
                <span className={cx('flex-1', task.status === 'done' && 'text-dim line-through')}>{task.description}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              value={draftMission?.goal ?? ''}
              onChange={(e) => onDraftMissionChange?.({ goal: e.target.value, maxTurns: draftMission?.maxTurns ?? 20 })}
              rows={2}
              className="w-full resize-none rounded-md border border-border-subtle bg-surface/45 px-2.5 py-1.5 text-[12px] text-primary outline-none placeholder:text-dim focus:border-accent/40"
              placeholder="Goal: what should be accomplished? (optional — inferred from conversation if blank)"
            />
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[11px] text-dim">
                Max turns
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={draftMission?.maxTurns ?? 20}
                  onChange={(e) =>
                    onDraftMissionChange?.({ goal: draftMission?.goal ?? '', maxTurns: Math.max(1, parseInt(e.target.value, 10) || 20) })
                  }
                  className="w-16 rounded-md border border-border-subtle bg-surface/45 px-2 py-1 text-[12px] text-primary outline-none"
                />
              </label>
              <span className="text-[10px] text-dim">Stop when all tasks done or max turns reached</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (mode === 'loop') {
    return (
      <div className="mb-2 px-0 py-1">
        <div className="mb-1.5 flex items-center justify-between px-0.5">
          <strong className="text-[11px] font-semibold text-secondary">Loop</strong>
          {running && loop ? (
            <span className="text-[10px] text-dim">
              {loop.iterationsUsed}/{loop.maxIterations} iterations
            </span>
          ) : (
            <span className="text-[10px] text-dim">Run exactly N iterations</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <textarea
            value={draftLoop?.prompt ?? loop?.prompt ?? ''}
            onChange={(e) =>
              onDraftLoopChange?.({
                prompt: e.target.value,
                maxIterations: draftLoop?.maxIterations ?? loop?.maxIterations ?? 5,
                delay: draftLoop?.delay ?? loop?.delay ?? 'After each turn',
              })
            }
            rows={2}
            className="w-full resize-none rounded-md border border-border-subtle bg-surface/45 px-2.5 py-1.5 text-[12px] text-primary outline-none placeholder:text-dim focus:border-accent/40"
            placeholder="Prompt to repeat each iteration"
          />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] text-dim">
              Iterations
              <input
                type="number"
                min={1}
                max={1000}
                value={draftLoop?.maxIterations ?? loop?.maxIterations ?? 5}
                onChange={(e) =>
                  onDraftLoopChange?.({
                    prompt: draftLoop?.prompt ?? loop?.prompt ?? '',
                    maxIterations: Math.max(1, parseInt(e.target.value, 10) || 5),
                    delay: draftLoop?.delay ?? loop?.delay ?? 'After each turn',
                  })
                }
                className="w-16 rounded-md border border-border-subtle bg-surface/45 px-2 py-1 text-[12px] text-primary outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-dim">
              Delay
              <input
                value={draftLoop?.delay ?? loop?.delay ?? 'After each turn'}
                onChange={(e) =>
                  onDraftLoopChange?.({
                    prompt: draftLoop?.prompt ?? loop?.prompt ?? '',
                    maxIterations: draftLoop?.maxIterations ?? loop?.maxIterations ?? 5,
                    delay: e.target.value,
                  })
                }
                className="w-28 rounded-md border border-border-subtle bg-surface/45 px-2 py-1 text-[12px] text-primary outline-none"
              />
            </label>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export function ConversationRunStatusStrip({ mode, running, mission, loop }: RunModePanelProps) {
  const isActive = running && (mode === 'mission' || mode === 'loop');
  if (!isActive) {
    return null;
  }

  if (mode === 'mission' && mission) {
    const done = mission.tasks.filter((t) => t.status === 'done').length;
    const total = mission.tasks.length;
    return (
      <div className="mb-1 flex items-center gap-2 px-0.5 py-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-accent">Mission</span>
        <span className="truncate text-[12px] font-medium text-primary">{mission.goal}</span>
        <span className="ml-auto shrink-0 text-[11px] text-dim">
          {done}/{total} tasks
        </span>
      </div>
    );
  }

  if (mode === 'loop' && loop) {
    return (
      <div className="mb-1 flex items-center gap-2 px-0.5 py-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-warning">Loop</span>
        <span className="truncate text-[12px] font-medium text-primary">
          {loop.prompt.slice(0, 60)}
          {loop.prompt.length > 60 ? '…' : ''}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-dim">
          {loop.iterationsUsed}/{loop.maxIterations}
        </span>
      </div>
    );
  }

  return null;
}
