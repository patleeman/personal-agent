import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

import {
  CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE,
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
import { logWarn } from '../middleware/index.js';

const AUTO_MODE_COMPACTION_RECOVERY_DELAY_MS = 1500;

const AutoModeControlToolNames = [CONVERSATION_AUTO_MODE_CONTROL_TOOL] as const;
const AutoModeControlToolNameSet = new Set<string>(AutoModeControlToolNames);
const REVIEW_TOOL_NAMES = new Set<string>([CONVERSATION_AUTO_MODE_CONTROL_TOOL, 'read', 'edit']);

// Track whether continue was already processed in the current turn.
// Cleared on turn_end so the next turn can call continue fresh.
const continueProcessedInTurn = new WeakMap<object, true>();

const ConversationAutoControlParams = Type.Object({
  action: Type.Union([Type.Literal('continue'), Type.Literal('stop')], {
    description:
      'Use "continue" when meaningful work remains against the active mission, or "stop" only when the mission is complete, blocked, needs user input, or budget is exhausted.',
  }),
  reason: Type.Optional(
    Type.String({
      description:
        'Required when stopping. Keep it short and human-readable, for example "done", "needs user input", or "blocked on tests".',
    }),
  ),
  stopCategory: Type.Optional(
    Type.Union([Type.Literal('complete'), Type.Literal('blocked'), Type.Literal('needs_user'), Type.Literal('budget_exhausted')], {
      description: 'Structured terminal reason when stopping.',
    }),
  ),
  confidence: Type.Optional(Type.Number({ description: 'Stop confidence from 0 to 1.' })),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveCurrentTurnSourceCustomType(sessionManager: { getBranch?: () => unknown[] }): string | null {
  const branch = typeof sessionManager.getBranch === 'function' ? sessionManager.getBranch() : [];

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
  if (active) {
    // During hidden review turns, restrict to only the control tool + read/edit
    // so the agent cannot run bash or call other tools.
    const current = pi.getActiveTools();
    if (current.length === REVIEW_TOOL_NAMES.size && current.every((name) => REVIEW_TOOL_NAMES.has(name))) {
      return;
    }
    pi.setActiveTools([...REVIEW_TOOL_NAMES]);
    return;
  }

  // Outside review turns, remove the auto control tool from the normal set.
  const current = pi.getActiveTools();
  const next = current.filter((name) => !AutoModeControlToolNameSet.has(name));
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
        void Promise.resolve(requestConversationAutoModeTurn(sessionId)).catch((error) => {
          logWarn('auto mode compaction recovery turn failed', {
            sessionId,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      }, AUTO_MODE_COMPACTION_RECOVERY_DELAY_MS);
      pendingCompactionRecoveryTimers.set(sessionId, timer);
    });

    pi.on('session_start', async (_event, ctx) => {
      setAutoModeControlToolActive(pi, isAutoModeHiddenReviewTurn(ctx.sessionManager));
    });

    pi.on('before_agent_start', async (_event, ctx) => {
      setAutoModeControlToolActive(pi, isAutoModeHiddenReviewTurn(ctx.sessionManager));
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
        'The user enabled auto mode because they want uninterrupted progress, so prefer action="continue" when meaningful work remains against the active mission.',
        'Use action="stop" only when the mission is complete, blocked on a real dependency, needs user input, or the explicit budget is exhausted.',
        'In tenacious or forced mode, weak stops are wrong: continue unless you can name a terminal stop category.',
        'If no explicit validation target was given, infer the expected level of doneness from the prompt and work so far.',
      ],
      parameters: ConversationAutoControlParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const sessionId = ctx.sessionManager.getSessionId?.()?.trim();
        const state = readConversationAutoModeStateFromSessionManager(ctx.sessionManager);

        if (!isAutoModeHiddenReviewTurn(ctx.sessionManager)) {
          throw new Error('conversation_auto_control is only available during hidden auto-review turns.');
        }

        // Safety check: explicitly reject if this is a continuation turn, not a review turn.
        const currentType = resolveCurrentTurnSourceCustomType(ctx.sessionManager);
        if (currentType === CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE) {
          throw new Error('conversation_auto_control cannot be called during continuation turns.');
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

          const remainingTurns = state.budget?.maxTurns;

          // Idempotency guard: skip duplicate continue calls within the same turn.
          // Uses the session manager object as key so it's naturally cleared on
          // turn_end (new turn = new agent start = fresh WeakMap access).
          if (continueProcessedInTurn.has(ctx.sessionManager as object)) {
            markConversationAutoModeContinueRequested(sessionId);
            return {
              content: [{ type: 'text' as const, text: 'Continue already processed in this turn.' }],
              details: { enabled: true, action: 'continue' },
            };
          }

          if (state.mode === 'forced' && remainingTurns === 0) {
            const nextState = await setLiveSessionAutoModeState(sessionId, {
              enabled: false,
              stopReason: 'budget exhausted',
              stopCategory: 'budget_exhausted',
              stopConfidence: 1,
            });
            return {
              content: [{ type: 'text' as const, text: 'Stopped auto mode: budget exhausted.' }],
              details: {
                enabled: nextState.enabled,
                action: 'stop',
                stopReason: nextState.stopReason,
                stopCategory: nextState.stopCategory,
                stopConfidence: nextState.stopConfidence,
                updatedAt: nextState.updatedAt,
              },
            };
          }

          if (state.mode === 'forced' && typeof remainingTurns === 'number') {
            await setLiveSessionAutoModeState(sessionId, {
              enabled: true,
              budget: { ...state.budget, maxTurns: remainingTurns - 1 },
            });
          }

          continueProcessedInTurn.set(ctx.sessionManager as object, true as const);
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
              stopCategory: params.stopCategory,
              stopConfidence: params.confidence,
            })
          : state;

        return {
          content: [
            {
              type: 'text' as const,
              text: nextState.stopReason ? `Stopped auto mode: ${nextState.stopReason}.` : 'Stopped auto mode.',
            },
          ],
          details: {
            enabled: nextState.enabled,
            action: 'stop',
            stopReason: nextState.stopReason,
            stopCategory: nextState.stopCategory,
            stopConfidence: nextState.stopConfidence,
            updatedAt: nextState.updatedAt,
          },
        };
      },
    });

    pi.on('turn_end', async (_event, ctx) => {
      const sessionId = ctx.sessionManager.getSessionId?.()?.trim();
      const sessionFile = ctx.sessionManager.getSessionFile?.()?.trim();

      // Clear the continue-processed flag for the next turn
      continueProcessedInTurn.delete(ctx.sessionManager as object);

      if (!sessionId && !sessionFile) {
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
        void Promise.resolve(
          sessionId
            ? requestConversationAutoModeTurn(sessionId, sessionFile)
            : sessionFile
              ? requestConversationAutoModeTurn(sessionFile, sessionFile)
              : Promise.resolve(false),
        ).catch((error) => {
          logWarn('auto mode turn_end request failed', {
            sessionId,
            sessionFile,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      });
    });
  };
}
