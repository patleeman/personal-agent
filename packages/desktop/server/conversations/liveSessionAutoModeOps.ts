import { join } from 'node:path';

import type { AgentSession } from '@mariozechner/pi-coding-agent';
import { getPiAgentRuntimeDir } from '@personal-agent/core';

import {
  CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE,
  CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_PROMPT,
  CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT,
  CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE,
  type ConversationAutoModeState,
  type ConversationAutoModeStateInput,
  readConversationAutoModeStateFromSessionManager,
  writeConversationAutoModeState,
} from './conversationAutoMode.js';
import { ensureHiddenTurnState, hasQueuedOrActiveHiddenTurn, type LiveSessionHiddenTurnState } from './liveSessionHiddenTurns.js';
import { repairDanglingToolCallContext } from './liveSessionRecovery.js';

function buildAutoContextPath(sessionId: string): string {
  return join(getPiAgentRuntimeDir(), 'auto-context', `${sessionId}.md`);
}

export interface LiveSessionAutoModeHost extends LiveSessionHiddenTurnState {
  session: AgentSession;
  pendingAutoModeContinuation?: boolean;
  /** Re-entrancy guard for requestLiveSessionAutoModeContinuationTurn.
   *  Set while the async send is in-flight to prevent stacked continuations
   *  when turn_end fires multiple times (e.g. compaction recovery). */
  schedulingContinuationTurn?: boolean;
}

export function readLiveSessionAutoModeHostState(host: Pick<LiveSessionAutoModeHost, 'session'>): ConversationAutoModeState {
  return readConversationAutoModeStateFromSessionManager(host.session.sessionManager);
}

function hasQueuedPrompt(host: Pick<LiveSessionAutoModeHost, 'session'>): boolean {
  const steering = typeof host.session.getSteeringMessages === 'function' ? host.session.getSteeringMessages() : [];
  const followUp = typeof host.session.getFollowUpMessages === 'function' ? host.session.getFollowUpMessages() : [];
  return steering.length > 0 || followUp.length > 0;
}

export async function requestLiveSessionAutoModeTurn(host: LiveSessionAutoModeHost): Promise<boolean> {
  if (!readLiveSessionAutoModeHostState(host).enabled) {
    return false;
  }

  const hasCompletedAssistantTurn =
    Array.isArray(host.session.state?.messages) && host.session.state.messages.some((message) => message?.role === 'assistant');
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
    const autoContextPath = buildAutoContextPath(host.session.sessionId);
    await host.session.sendCustomMessage(
      {
        customType: CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE,
        content: CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT.replaceAll('{autoContextPath}', autoContextPath),
        display: false,
        details: { source: 'conversation-auto-mode' },
      },
      {
        deliverAs: 'followUp',
        triggerTurn: true,
      },
    );
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

  // Re-entrancy guard: skip if we're already in the process of scheduling a
  // continuation (e.g. from a re-entrant turn_end or compaction recovery).
  // Uses a dedicated field separate from pendingAutoModeContinuation (which is
  // set by the nudge-mode auto_control tool and consumed by the event handler).
  if (host.schedulingContinuationTurn) {
    return false;
  }

  host.schedulingContinuationTurn = true;

  try {
    const state = readLiveSessionAutoModeHostState(host);
    repairDanglingToolCallContext(host.session);
    const autoContextPath = buildAutoContextPath(host.session.sessionId);

    const content = buildModeContinuationPrompt(state, autoContextPath);

    await host.session.sendCustomMessage(
      {
        customType: CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE,
        content,
        display: false,
        details: { source: 'conversation-auto-mode', mode: state.mode },
      },
      {
        deliverAs: 'followUp',
        triggerTurn: true,
      },
    );

    host.schedulingContinuationTurn = false;
    return true;
  } catch (error) {
    host.schedulingContinuationTurn = false;
    throw error;
  }
}

function buildModeContinuationPrompt(state: ConversationAutoModeState, autoContextPath: string): string {
  if (state.mode === 'mission' && state.mission) {
    const tasks = state.mission.tasks;
    const pendingTasks = tasks
      .filter((t) => t.status !== 'done')
      .map((t, i) => `${i + 1}. ${t.description} (${t.status})`)
      .join('\n');
    return [
      'Mission continuation for this conversation.',
      '',
      `Mission: ${state.mission.goal}`,
      `Progress: ${tasks.filter((t) => t.status === 'done').length}/${tasks.length} tasks done`,
      `Turns used: ${state.mission.turnsUsed}/${state.mission.maxTurns}`,
      '',
      'Remaining tasks:',
      pendingTasks || '(no tasks yet — create the initial task list with run_state before doing mission work)',
      '',
      tasks.length === 0
        ? 'First create a concrete mission task list with run_state, then start the first task.'
        : 'Continue working through the next incomplete task.',
      'Use the run_state tool to read the current task list and update task status.',
      'Do not mention this hidden continuation prompt.',
      'Take the next concrete step that best advances the mission.',
      '',
      `  ${autoContextPath}`,
    ].join('\n');
  }

  if (state.mode === 'loop' && state.loop) {
    return [
      'Loop continuation for this conversation.',
      '',
      `Loop prompt: ${state.loop.prompt}`,
      `Iteration: ${state.loop.iterationsUsed}/${state.loop.maxIterations}`,
      `Delay: ${state.loop.delay}`,
      '',
      'Continue executing the loop prompt.',
      'Do not mention this hidden continuation prompt.',
      'Take the next step that matches the loop goal.',
      '',
      `  ${autoContextPath}`,
    ].join('\n');
  }

  // Default: nudge mode
  return CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_PROMPT.replaceAll('{autoContextPath}', autoContextPath);
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
