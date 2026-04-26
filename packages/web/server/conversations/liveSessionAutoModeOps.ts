import type { AgentSession } from '@mariozechner/pi-coding-agent';
import {
  CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE,
  CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_PROMPT,
  CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT,
  CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE,
  readConversationAutoModeStateFromSessionManager,
  writeConversationAutoModeState,
  type ConversationAutoModeState,
  type ConversationAutoModeStateInput,
} from './conversationAutoMode.js';
import { ensureHiddenTurnState, hasQueuedOrActiveHiddenTurn, type LiveSessionHiddenTurnState } from './liveSessionHiddenTurns.js';
import { repairDanglingToolCallContext } from './liveSessionRecovery.js';

export interface LiveSessionAutoModeHost extends LiveSessionHiddenTurnState {
  session: AgentSession;
  pendingAutoModeContinuation?: boolean;
}

export function readLiveSessionAutoModeHostState(host: Pick<LiveSessionAutoModeHost, 'session'>): ConversationAutoModeState {
  return readConversationAutoModeStateFromSessionManager(host.session.sessionManager);
}

function hasQueuedPrompt(host: Pick<LiveSessionAutoModeHost, 'session'>): boolean {
  const steering = typeof host.session.getSteeringMessages === 'function'
    ? host.session.getSteeringMessages()
    : [];
  const followUp = typeof host.session.getFollowUpMessages === 'function'
    ? host.session.getFollowUpMessages()
    : [];
  return steering.length > 0 || followUp.length > 0;
}

export async function requestLiveSessionAutoModeTurn(host: LiveSessionAutoModeHost): Promise<boolean> {
  if (!readLiveSessionAutoModeHostState(host).enabled) {
    return false;
  }

  const hasCompletedAssistantTurn = Array.isArray(host.session.state?.messages)
    && host.session.state.messages.some((message) => message?.role === 'assistant');
  if (!hasCompletedAssistantTurn) {
    return false;
  }

  if (host.session.isStreaming || hasQueuedOrActiveHiddenTurn(host)) {
    return false;
  }

  if (hasQueuedPrompt(host)) {
    return false;
  }

  ensureHiddenTurnState(host);
  host.pendingHiddenTurnCustomTypes.push(CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE);

  try {
    repairDanglingToolCallContext(host.session);
    await host.session.sendCustomMessage({
      customType: CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE,
      content: CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT,
      display: false,
      details: { source: 'conversation-auto-mode' },
    }, {
      deliverAs: 'followUp',
      triggerTurn: true,
    });
    return true;
  } catch (error) {
    const pendingIndex = host.pendingHiddenTurnCustomTypes.lastIndexOf(CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE);
    if (pendingIndex >= 0) {
      host.pendingHiddenTurnCustomTypes.splice(pendingIndex, 1);
    }
    throw error;
  }
}

export function markLiveSessionAutoModeContinueRequested(host: LiveSessionAutoModeHost): void {
  host.pendingAutoModeContinuation = true;
}

export async function requestLiveSessionAutoModeContinuationTurn(host: LiveSessionAutoModeHost): Promise<boolean> {
  if (!readLiveSessionAutoModeHostState(host).enabled || host.session.isStreaming) {
    return false;
  }

  if (hasQueuedPrompt(host)) {
    return false;
  }

  repairDanglingToolCallContext(host.session);
  await host.session.sendCustomMessage({
    customType: CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE,
    content: CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_PROMPT,
    display: false,
    details: { source: 'conversation-auto-mode' },
  }, {
    deliverAs: 'followUp',
    triggerTurn: true,
  });
  return true;
}

export function writeLiveSessionAutoModeHostState(
  host: LiveSessionAutoModeHost,
  input: ConversationAutoModeStateInput,
): ConversationAutoModeState {
  const nextState = writeConversationAutoModeState(host.session.sessionManager, input);
  if (!nextState.enabled) {
    host.pendingAutoModeContinuation = false;
  }
  return nextState;
}
