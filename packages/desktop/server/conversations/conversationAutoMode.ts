/**
 * @deprecated Legacy pre-extension auto-mode state. New autonomous looping is
 * owned by the system-auto-mode goal-mode extension (`conversation-goal`). Keep
 * this module only for old session files and companion API compatibility; do
 * not add new callers or scheduler behavior here.
 */
export type ConversationRunMode = 'manual' | 'nudge' | 'mission' | 'loop';
export type ConversationTaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked';

export interface ConversationAutoModeTask {
  id: string;
  description: string;
  status: ConversationTaskStatus;
}

export interface ConversationAutoModeState {
  enabled: boolean;
  mode: ConversationRunMode;
  stopReason: string | null;
  updatedAt: string | null;
  mission?: { goal: string; tasks: ConversationAutoModeTask[] };
  loop?: { prompt: string; maxIterations: number; iterationsUsed: number; delay: string };
}

export const DEFAULT_CONVERSATION_AUTO_MODE_STATE: ConversationAutoModeState = {
  enabled: false,
  mode: 'manual',
  stopReason: null,
  updatedAt: null,
};

export const CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT = [
  'The user enabled auto mode because they want you to keep working without waiting for user input.',
  'Decide whether to continue or stop.',
  'Use action "stop" only when the task is complete for the user\'s request, blocked on a real dependency, or needs user input.',
  'Err toward continuing when useful work remains.',
].join('\n');

export function normalizeRunMode(value: unknown): ConversationRunMode {
  return value === 'nudge' || value === 'mission' || value === 'loop' || value === 'manual' ? value : 'manual';
}

export function createTask(description: string, status: ConversationTaskStatus = 'pending'): ConversationAutoModeTask {
  return { id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, description, status };
}

export function areAllTasksDone(tasks: ConversationAutoModeTask[]): boolean {
  return tasks.length > 0 && tasks.every((task) => task.status === 'done');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTimestamp(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value) ? value : null;
}

function normalizeTask(value: unknown): ConversationAutoModeTask | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.description !== 'string') return null;
  const status =
    value.status === 'done' || value.status === 'in_progress' || value.status === 'blocked' || value.status === 'pending'
      ? value.status
      : 'pending';
  return { id: value.id, description: value.description, status };
}

function normalizeState(data: unknown): ConversationAutoModeState | null {
  if (!isRecord(data)) return null;
  const hasExplicitMode = typeof data.mode === 'string';
  const mode = hasExplicitMode
    ? normalizeRunMode(data.mode)
    : data.enabled === true
      ? 'nudge'
      : data.enabled === false
        ? 'manual'
        : 'manual';
  if (hasExplicitMode && mode === 'manual' && data.mode !== 'manual') return null;
  if (!hasExplicitMode && typeof data.enabled !== 'boolean') return null;
  const state: ConversationAutoModeState = {
    enabled: mode !== 'manual',
    mode,
    stopReason: typeof data.stopReason === 'string' && data.stopReason.trim() ? data.stopReason.trim() : null,
    updatedAt: normalizeTimestamp(data.updatedAt),
  };
  if (mode !== 'manual') state.stopReason = null;
  if (mode === 'mission' && isRecord(data.mission)) {
    const tasks = Array.isArray(data.mission.tasks)
      ? data.mission.tasks.map(normalizeTask).filter((task): task is ConversationAutoModeTask => Boolean(task))
      : [];
    state.mission = { goal: typeof data.mission.goal === 'string' ? data.mission.goal : '', tasks };
  }
  if (mode === 'loop' && isRecord(data.loop)) {
    state.loop = {
      prompt: typeof data.loop.prompt === 'string' ? data.loop.prompt : '',
      maxIterations: typeof data.loop.maxIterations === 'number' ? data.loop.maxIterations : 0,
      iterationsUsed: typeof data.loop.iterationsUsed === 'number' ? data.loop.iterationsUsed : 0,
      delay: typeof data.loop.delay === 'string' ? data.loop.delay : '',
    };
  }
  return state;
}

export function readConversationAutoModeStateFromEntries(entries: unknown[]): ConversationAutoModeState {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isRecord(entry) || entry.type !== 'custom' || entry.customType !== 'conversation-auto-mode') continue;
    const state = normalizeState(entry.data);
    if (state) return state;
  }
  return DEFAULT_CONVERSATION_AUTO_MODE_STATE;
}

export function readConversationAutoModeStateFromSessionManager(sessionManager: {
  getEntries: () => unknown[];
}): ConversationAutoModeState {
  return readConversationAutoModeStateFromEntries(sessionManager.getEntries());
}

export function writeConversationAutoModeState(
  sessionManager: { getEntries: () => unknown[]; appendCustomEntry: (type: string, data: unknown) => void },
  input: Partial<ConversationAutoModeState>,
): ConversationAutoModeState {
  const requestedMode = input.mode ?? (input.enabled ? 'nudge' : 'manual');
  const mode = normalizeRunMode(requestedMode);
  const state: ConversationAutoModeState = {
    enabled: mode !== 'manual',
    mode,
    stopReason: mode === 'manual' && typeof input.stopReason === 'string' && input.stopReason.trim() ? input.stopReason.trim() : null,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
  };
  if (mode === 'mission') state.mission = { goal: input.mission?.goal ?? '', tasks: input.mission?.tasks ?? [] };
  if (mode === 'loop') state.loop = input.loop ?? { prompt: '', maxIterations: 0, iterationsUsed: 0, delay: '' };
  sessionManager.appendCustomEntry('conversation-auto-mode', state);
  return state;
}
