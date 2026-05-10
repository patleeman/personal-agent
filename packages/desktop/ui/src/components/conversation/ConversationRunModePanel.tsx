import { type FormEvent, useState } from 'react';

interface MissionTask {
  id: string;
  description: string;
  status: string;
}

export function ConversationRunModePanel({
  mode,
  mission,
  loop,
  draftLoop,
  onDraftMissionChange,
  onAddMissionTask,
}: {
  mode: 'mission' | 'loop' | 'nudge' | 'manual';
  running?: boolean;
  mission?: { goal: string; tasks: MissionTask[] };
  loop?: { prompt: string; maxIterations: number; iterationsUsed: number; delay: string };
  draftLoop?: { prompt: string; maxIterations: number; delay: string };
  onDraftMissionChange?: (change: { goal: string }) => void;
  onAddMissionTask?: (description: string) => void;
}) {
  const [taskInput, setTaskInput] = useState('');
  const activeLoop = loop ?? (draftLoop ? { ...draftLoop, iterationsUsed: 0 } : null);

  if (mode === 'mission') {
    const tasks = mission?.tasks ?? [];
    const submitTask = (event: FormEvent) => {
      event.preventDefault();
      const trimmed = taskInput.trim();
      if (!trimmed) return;
      onAddMissionTask?.(trimmed);
      setTaskInput('');
    };
    return (
      <section aria-label="Run mode" className="space-y-2">
        <span>Tasks</span>
        <input
          aria-label="Mission goal"
          defaultValue={mission?.goal ?? ''}
          onBlur={(event) => onDraftMissionChange?.({ goal: event.currentTarget.value })}
        />
        <ul>
          {tasks.map((task) => (
            <li key={task.id}>{task.description}</li>
          ))}
        </ul>
        <form onSubmit={submitTask}>
          <input aria-label="Add mission task" value={taskInput} onChange={(event) => setTaskInput(event.currentTarget.value)} />
          <button type="submit" disabled={!taskInput.trim()}>
            Add
          </button>
        </form>
      </section>
    );
  }

  if (mode === 'loop' && activeLoop) {
    return (
      <section aria-label="Run mode" className="space-y-2">
        <span>Run</span>
        <label>
          Prompt to repeat each iteration
          <input aria-label="Loop prompt" defaultValue={activeLoop.prompt} />
        </label>
        <input aria-label="Loop max iterations" defaultValue={activeLoop.maxIterations} />
        <select aria-label="Loop delay" value={activeLoop.delay} readOnly>
          <option value={activeLoop.delay}>{activeLoop.delay}</option>
        </select>
      </section>
    );
  }

  return null;
}
