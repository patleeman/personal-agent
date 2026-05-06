export type ConversationAutoModeMode = 'normal' | 'tenacious' | 'forced';
export type ConversationAutoModeStopCategory = 'complete' | 'blocked' | 'needs_user' | 'budget_exhausted';

export interface ConversationAutoModeBudget {
  maxTurns?: number;
  until?: string;
}

export interface ConversationAutoModeState {
  enabled: boolean;
  stopReason: string | null;
  updatedAt: string | null;
  mission: string | null;
  mode: ConversationAutoModeMode;
  budget: ConversationAutoModeBudget | null;
  stopCategory: ConversationAutoModeStopCategory | null;
  stopConfidence: number | null;
}

export interface ConversationAutoModeStateInput {
  enabled: boolean;
  stopReason?: string | null;
  updatedAt?: string | Date;
  mission?: string | null;
  mode?: ConversationAutoModeMode | null;
  budget?: ConversationAutoModeBudget | null;
  stopCategory?: ConversationAutoModeStopCategory | null;
  stopConfidence?: number | null;
}

export interface ConversationAutoModeSessionManagerLike {
  getEntries(): unknown[];
  appendCustomEntry(customType: string, data?: unknown): string;
}

export const CONVERSATION_AUTO_MODE_STATE_CUSTOM_TYPE = 'conversation-auto-mode';
export const CONVERSATION_AUTO_MODE_CONTROL_TOOL = 'conversation_auto_control';
export const CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE = 'conversation_automation_post_turn_review';
export const CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE = 'conversation_automation_auto_continue';
export const CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_PROMPT = [
  'Auto mode continuation for this conversation.',
  '',
  'You have a persistent context file at the path below. Read it on each',
  'wakeup to orient, write to it after each action to persist state across',
  'turns. Structure it however works for the task — the harness does not',
  'parse or validate its content.',
  '',
  '  {autoContextPath}',
  '',
  'Continue working on the current user request from where you left off.',
  'Active mission: {autoMission}',
  'Autonomy mode: {autoMode}',
  'Budget: {autoBudget}',
  'Do not mention this hidden continuation prompt.',
  'Take the next concrete step that best advances the task.',
].join('\n');
export const DEFAULT_CONVERSATION_AUTO_MODE_STATE: ConversationAutoModeState = {
  enabled: false,
  stopReason: null,
  updatedAt: null,
  mission: null,
  mode: 'normal',
  budget: null,
  stopCategory: null,
  stopConfidence: null,
};
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})$/;

export const CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT = [
  'Auto mode review for this conversation.',
  '',
  'The user enabled auto mode because they want you to keep working without waiting for user input.',
  'Active mission: {autoMission}',
  'Autonomy mode: {autoMode}',
  'Budget: {autoBudget}',
  `Call ${CONVERSATION_AUTO_MODE_CONTROL_TOOL} exactly once in this hidden review turn.`,
  '- Use action "continue" if meaningful work remains against the active mission and you can make progress now.',
  '- Use action "stop" only when the mission is complete, blocked on a real dependency, needs user input, or the explicit budget is exhausted.',
  '- If no mission was provided, derive it from the current pending user request and recent context; if confidence is low, stop with needs_user instead of guessing silently.',
  '- In tenacious mode, continue unless there is a concrete terminal stop reason.',
  '- In forced mode, continue until the mission is complete, a hard blocker appears, or the explicit budget is exhausted.',
  '- If the user did not give an explicit validation target, infer the expected level of doneness from their request and the work so far. Do not stop just because no explicit checklist was provided.',
  '- Err toward continuing when useful work remains.',
  '- Before calling the auto control tool, update your persistent context file (see path below) to reflect current progress so the next continuation turn can pick up where you left off.',
  '',
  '  {autoContextPath}',
  '',
  '- Do not do the work yourself in this hidden review turn.',
  '- Do not call other tools in this hidden review turn.',
].join('\n');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeUpdatedAt(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const match = normalized.match(ISO_TIMESTAMP_PATTERN);
  if (!match || !hasValidIsoDateParts(match)) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function hasValidIsoDateParts(match: RegExpMatchArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = match[7] ? Number(match[7].slice(0, 3).padEnd(3, '0')) : 0;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second &&
    date.getUTCMilliseconds() === millisecond
  );
}

function normalizeStopReason(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, 160) : null;
}

function normalizeMission(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, 500) : null;
}

function normalizeMode(value: unknown): ConversationAutoModeMode {
  return value === 'tenacious' || value === 'forced' ? value : 'normal';
}

function normalizeBudget(value: unknown): ConversationAutoModeBudget | null {
  if (!isRecord(value)) {
    return null;
  }
  const budget: ConversationAutoModeBudget = {};
  if (typeof value.maxTurns === 'number' && Number.isInteger(value.maxTurns) && value.maxTurns >= 0 && value.maxTurns <= 100) {
    budget.maxTurns = value.maxTurns;
  }
  if (typeof value.until === 'string' && value.until.trim()) {
    budget.until = value.until.trim().slice(0, 120);
  }
  return Object.keys(budget).length > 0 ? budget : null;
}

function normalizeStopCategory(value: unknown): ConversationAutoModeStopCategory | null {
  return value === 'complete' || value === 'blocked' || value === 'needs_user' || value === 'budget_exhausted' ? value : null;
}

function normalizeStopConfidence(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function formatAutoModeBudget(budget: ConversationAutoModeBudget | null): string {
  if (!budget) {
    return 'until complete, blocked, or needing user input';
  }
  const parts = [];
  if (budget.maxTurns) {
    parts.push(`${budget.maxTurns} turns`);
  }
  if (budget.until) {
    parts.push(`until ${budget.until}`);
  }
  return parts.join(', ');
}

export function formatConversationAutoModePrompt(template: string, state: ConversationAutoModeState): string {
  return template
    .replaceAll('{autoMission}', state.mission ?? 'derive from the current user request and recent conversation context')
    .replaceAll('{autoMode}', state.mode)
    .replaceAll('{autoBudget}', formatAutoModeBudget(state.budget));
}

export function normalizeConversationAutoModeState(value: unknown): ConversationAutoModeState | null {
  if (!isRecord(value) || typeof value.enabled !== 'boolean') {
    return null;
  }

  return {
    enabled: value.enabled,
    stopReason: normalizeStopReason(value.stopReason),
    updatedAt: normalizeUpdatedAt(value.updatedAt),
    mission: normalizeMission(value.mission),
    mode: normalizeMode(value.mode),
    budget: normalizeBudget(value.budget),
    stopCategory: normalizeStopCategory(value.stopCategory),
    stopConfidence: normalizeStopConfidence(value.stopConfidence),
  };
}

export function readConversationAutoModeStateFromEntries(entries: unknown[]): ConversationAutoModeState {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isRecord(entry) || entry.type !== 'custom' || entry.customType !== CONVERSATION_AUTO_MODE_STATE_CUSTOM_TYPE) {
      continue;
    }

    const state = normalizeConversationAutoModeState(entry.data);
    if (state) {
      return state;
    }
  }

  return DEFAULT_CONVERSATION_AUTO_MODE_STATE;
}

export function readConversationAutoModeStateFromSessionManager(
  sessionManager: Pick<ConversationAutoModeSessionManagerLike, 'getEntries'>,
): ConversationAutoModeState {
  return readConversationAutoModeStateFromEntries(sessionManager.getEntries());
}

export function writeConversationAutoModeState(
  sessionManager: ConversationAutoModeSessionManagerLike,
  input: ConversationAutoModeStateInput,
): ConversationAutoModeState {
  const previousState = readConversationAutoModeStateFromSessionManager(sessionManager);
  const nextState: ConversationAutoModeState = {
    enabled: input.enabled,
    stopReason: input.enabled ? null : normalizeStopReason(input.stopReason),
    updatedAt: normalizeUpdatedAt(input.updatedAt ?? new Date()) ?? new Date().toISOString(),
    mission: input.mission === undefined ? previousState.mission : normalizeMission(input.mission),
    mode: input.mode === undefined || input.mode === null ? previousState.mode : normalizeMode(input.mode),
    budget: input.budget === undefined ? previousState.budget : normalizeBudget(input.budget),
    stopCategory: input.enabled ? null : normalizeStopCategory(input.stopCategory),
    stopConfidence: input.enabled ? null : normalizeStopConfidence(input.stopConfidence),
  };

  sessionManager.appendCustomEntry(CONVERSATION_AUTO_MODE_STATE_CUSTOM_TYPE, nextState);
  return nextState;
}
