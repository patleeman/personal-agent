import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  CONVERSATION_AUTO_MODE_CONTROL_TOOL,
  CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE,
  readConversationAutoModeStateFromSessionManager,
} from '../conversations/conversationAutoMode.js';
import {
  markConversationAutoModeContinueRequested,
  registerLiveSessionLifecycleHandler,
  requestConversationAutoModeTurn,
  setLiveSessionAutoModeState,
} from '../conversations/liveSessions.js';

const AUTO_MODE_COMPACTION_RECOVERY_DELAY_MS = 1500;

const AutoModeControlToolNames = [CONVERSATION_AUTO_MODE_CONTROL_TOOL] as const;
const AutoModeControlToolNameSet = new Set<string>(AutoModeControlToolNames);

const ConversationAutoControlParams = Type.Object({
  action: Type.Union([
    Type.Literal('continue'),
    Type.Literal('stop'),
  ], {
    description: 'Use "continue" when meaningful work remains and auto mode should keep going, or "stop" only when the task is complete, blocked, or needs user input.',
  }),
  reason: Type.Optional(Type.String({
    description: 'Required when stopping. Keep it short and human-readable, for example "done", "needs user input", or "blocked on tests".',
  })),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveCurrentTurnSourceCustomType(sessionManager: {
  getBranch?: () => unknown[];
}): string | null {
  const branch = typeof sessionManager.getBranch === 'function'
    ? sessionManager.getBranch()
    : [];

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (!isRecord(entry)) {
      continue;
    }

    if (entry.type === 'custom_message' && typeof entry.customType === 'string') {
      return entry.customType;
    }

    if (entry.type === 'message' && isRecord(entry.message) && entry.message.role === 'user') {
      return 'user';
    }
  }

  return null;
}

function isAutoModeHiddenReviewTurn(sessionManager: { getBranch?: () => unknown[] }): boolean {
  return resolveCurrentTurnSourceCustomType(sessionManager) === CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE;
}

function setAutoModeControlToolActive(pi: ExtensionAPI, active: boolean): void {
  const current = pi.getActiveTools();
  const withoutAutoControlTool = current.filter((name) => !AutoModeControlToolNameSet.has(name));
  const next = active ? [...withoutAutoControlTool, ...AutoModeControlToolNames] : withoutAutoControlTool;
  if (current.length === next.length && current.every((name, index) => name === next[index])) {
    return;
  }
  pi.setActiveTools(next);
}

export function createConversationAutoModeAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    const pendingCompactionRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const clearCompactionRecoveryTimer = (sessionId: string) => {
      const timer = pendingCompactionRecoveryTimers.get(sessionId);
      if (!timer) {
        return;
      }

      clearTimeout(timer);
      pendingCompactionRecoveryTimers.delete(sessionId);
    };

    registerLiveSessionLifecycleHandler((event) => {
      const sessionId = event.conversationId.trim();
      if (!sessionId) {
        return;
      }

      if (event.trigger === 'turn_end') {
        clearCompactionRecoveryTimer(sessionId);
        return;
      }

      clearCompactionRecoveryTimer(sessionId);
      const timer = setTimeout(() => {
        pendingCompactionRecoveryTimers.delete(sessionId);
        void Promise.resolve(requestConversationAutoModeTurn(sessionId)).catch(() => undefined);
      }, AUTO_MODE_COMPACTION_RECOVERY_DELAY_MS);
      pendingCompactionRecoveryTimers.set(sessionId, timer);
    });

    pi.on('session_start', async (_event, ctx) => {
      setAutoModeControlToolActive(pi, isAutoModeHiddenReviewTurn(ctx.sessionManager));
    });

    pi.on('before_agent_start', async (_event, ctx) => {
      setAutoModeControlToolActive(pi, isAutoModeHiddenReviewTurn(ctx.sessionManager));
    });

    pi.registerTool({
      name: CONVERSATION_AUTO_MODE_CONTROL_TOOL,
      label: 'Conversation auto control',
      description: 'Control conversation auto mode from hidden auto-review turns. Prefer continuing while useful work remains.',
      promptSnippet: 'Decide whether conversation auto mode should continue or stop.',
      promptGuidelines: [
        'Use this tool only during hidden auto-review turns for conversation auto mode.',
        'The user enabled auto mode because they want uninterrupted progress, so prefer action="continue" when meaningful work remains.',
        'Use action="stop" only when the task is complete for the user\'s request, blocked on a real dependency, or needs user input.',
        'If no explicit validation target was given, infer the expected level of doneness from the prompt and work so far.',
      ],
      parameters: ConversationAutoControlParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const sessionId = ctx.sessionManager.getSessionId?.()?.trim();
        const state = readConversationAutoModeStateFromSessionManager(ctx.sessionManager);

        if (!isAutoModeHiddenReviewTurn(ctx.sessionManager)) {
          throw new Error('conversation_auto_control is only available during hidden auto-review turns.');
        }

        if (params.action === 'continue') {
          if (!sessionId) {
            throw new Error('Conversation auto mode requires a persisted live session.');
          }
          if (!state.enabled) {
            return {
              content: [{ type: 'text' as const, text: 'Auto mode is off, so no continuation was queued.' }],
              details: { enabled: false, action: 'continue' },
            };
          }

          markConversationAutoModeContinueRequested(sessionId);
          return {
            content: [{ type: 'text' as const, text: 'Auto mode will continue after this hidden review turn.' }],
            details: { enabled: true, action: 'continue' },
          };
        }

        const nextState = sessionId
          ? await setLiveSessionAutoModeState(sessionId, {
              enabled: false,
              stopReason: params.reason,
            })
          : state;

        return {
          content: [{
            type: 'text' as const,
            text: nextState.stopReason
              ? `Stopped auto mode: ${nextState.stopReason}.`
              : 'Stopped auto mode.',
          }],
          details: {
            enabled: nextState.enabled,
            action: 'stop',
            stopReason: nextState.stopReason,
            updatedAt: nextState.updatedAt,
          },
        };
      },
    });

    pi.on('turn_end', async (_event, ctx) => {
      const sessionId = ctx.sessionManager.getSessionId?.()?.trim();
      if (!sessionId) {
        return;
      }

      const state = readConversationAutoModeStateFromSessionManager(ctx.sessionManager);
      if (!state.enabled) {
        return;
      }

      if (isAutoModeHiddenReviewTurn(ctx.sessionManager)) {
        return;
      }

      queueMicrotask(() => {
        void Promise.resolve(requestConversationAutoModeTurn(sessionId)).catch(() => undefined);
      });
    });
  };
}
