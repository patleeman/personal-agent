export interface ConversationAutoModeState {
  enabled: boolean;
  stopReason: string | null;
  updatedAt: string | null;
}

export interface ConversationAutoModeStateInput {
  enabled: boolean;
  stopReason?: string | null;
  updatedAt?: string | Date;
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
  'Continue working on the current user request from where you left off.',
  'Do not mention this hidden continuation prompt.',
  'Take the next concrete step that best advances the task.',
].join('\n');
export const DEFAULT_CONVERSATION_AUTO_MODE_STATE: ConversationAutoModeState = {
  enabled: false,
  stopReason: null,
  updatedAt: null,
};
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT = [
  'Auto mode review for this conversation.',
  '',
  'The user enabled auto mode because they want you to keep working without waiting for user input.',
  `Call ${CONVERSATION_AUTO_MODE_CONTROL_TOOL} exactly once in this hidden review turn.`,
  '- Use action "continue" if there is meaningful remaining work you can do now.',
  '- Use action "stop" only when the task is complete for the user\'s request, blocked on a real dependency, or needs user input.',
  '- If the user did not give an explicit validation target, infer the expected level of doneness from their request and the work so far. Do not stop just because no explicit checklist was provided.',
  '- Err toward continuing when useful work remains.',
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
  if (!ISO_TIMESTAMP_PATTERN.test(normalized)) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeStopReason(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, 160) : null;
}

export function normalizeConversationAutoModeState(value: unknown): ConversationAutoModeState | null {
  if (!isRecord(value) || typeof value.enabled !== 'boolean') {
    return null;
  }

  return {
    enabled: value.enabled,
    stopReason: normalizeStopReason(value.stopReason),
    updatedAt: normalizeUpdatedAt(value.updatedAt),
  };
}

export function readConversationAutoModeStateFromEntries(entries: unknown[]): ConversationAutoModeState {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isRecord(entry)
      || entry.type !== 'custom'
      || entry.customType !== CONVERSATION_AUTO_MODE_STATE_CUSTOM_TYPE) {
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
  const nextState: ConversationAutoModeState = {
    enabled: input.enabled,
    stopReason: input.enabled ? null : normalizeStopReason(input.stopReason),
    updatedAt: normalizeUpdatedAt(input.updatedAt ?? new Date()) ?? new Date().toISOString(),
  };

  sessionManager.appendCustomEntry(CONVERSATION_AUTO_MODE_STATE_CUSTOM_TYPE, nextState);
  return nextState;
}
