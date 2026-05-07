import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

import {
  areAllTasksDone,
  CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE,
  CONVERSATION_AUTO_MODE_CONTROL_TOOL,
  CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE,
  type ConversationAutoModeState,
  createTask,
  readConversationAutoModeStateFromSessionManager,
  type RunMode,
  writeConversationAutoModeState,
} from '../conversations/conversationAutoMode.js';
import {
  markConversationAutoModeContinueRequested,
  registerLiveSessionLifecycleHandler,
  requestConversationAutoModeContinuationTurn,
  requestConversationAutoModeTurn,
  setLiveSessionAutoModeState,
} from '../conversations/liveSessions.js';
import { logWarn } from '../middleware/index.js';

export const RUN_STATE_TOOL = 'run_state' as const;

const AUTO_MODE_COMPACTION_RECOVERY_DELAY_MS = 1500;

const ConversationAutoControlParams = Type.Object({
  action: Type.Union([Type.Literal('continue'), Type.Literal('stop')], {
    description:
      'Use "continue" when meaningful work remains and auto mode should keep going, or "stop" only when the task is complete, blocked, or needs user input.',
  }),
  reason: Type.Optional(
    Type.String({
      description:
        'Required when stopping. Keep it short and human-readable, for example "done", "needs user input", or "blocked on tests".',
    }),
  ),
});

const RunStateParams = Type.Object({
  action: Type.Union([Type.Literal('get'), Type.Literal('update_tasks')], {
    description: '"get" returns the current mission/loop state. "update_tasks" updates task statuses.',
  }),
  tasks: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.Optional(Type.String({ description: 'Task id. Omit to create a new task.' })),
        description: Type.Optional(Type.String({ description: 'Task description (only for new tasks).' })),
        status: Type.Optional(
          Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('done'), Type.Literal('blocked')]),
        ),
      }),
      { description: 'Task patches. Include id + status for updates. Omit id for new tasks.' },
    ),
  ),
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

function isContinuationTurn(sessionManager: { getBranch?: () => unknown[] }): boolean {
  return resolveCurrentTurnSourceCustomType(sessionManager) === CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE;
}

function readState(ctx: { sessionManager: { getEntries: () => unknown[] } }): ConversationAutoModeState {
  return readConversationAutoModeStateFromSessionManager(ctx.sessionManager);
}

function readMode(ctx: { sessionManager: { getEntries: () => unknown[] } }): RunMode {
  return readState(ctx).mode;
}

function syncToolsForMode(pi: ExtensionAPI, state: ConversationAutoModeState, isReviewTurn: boolean): void {
  const current = pi.getActiveTools();
  const hasAutoControl = current.includes(CONVERSATION_AUTO_MODE_CONTROL_TOOL);
  const hasRunState = current.includes(RUN_STATE_TOOL);

  const shouldHaveAutoControl = state.mode === 'nudge' && isReviewTurn;
  const shouldHaveRunState = state.mode === 'mission' || state.mode === 'loop';

  if (hasAutoControl === shouldHaveAutoControl && hasRunState === shouldHaveRunState) {
    return;
  }

  const next = [...current];

  if (hasAutoControl && !shouldHaveAutoControl) {
    const idx = next.indexOf(CONVERSATION_AUTO_MODE_CONTROL_TOOL);
    if (idx >= 0) next.splice(idx, 1);
  } else if (!hasAutoControl && shouldHaveAutoControl) {
    next.push(CONVERSATION_AUTO_MODE_CONTROL_TOOL);
  }

  if (hasRunState && !shouldHaveRunState) {
    const idx = next.indexOf(RUN_STATE_TOOL);
    if (idx >= 0) next.splice(idx, 1);
  } else if (!hasRunState && shouldHaveRunState) {
    next.push(RUN_STATE_TOOL);
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

    // ── Lifecycle: compaction recovery ──────────────────────────────────
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

    // ── Tool visibility ─────────────────────────────────────────────────
    function syncTools(_event: unknown, ctx: { sessionManager: { getBranch?: () => unknown[]; getEntries: () => unknown[] } }): void {
      const state = readState(ctx);
      const isReviewTurn = isAutoModeHiddenReviewTurn(ctx.sessionManager);
      syncToolsForMode(pi, state, isReviewTurn);
    }

    pi.on('session_start', syncTools);
    pi.on('before_agent_start', syncTools);

    // ── Register conversation_auto_control tool (nudge mode only) ──────
    pi.registerTool({
      name: CONVERSATION_AUTO_MODE_CONTROL_TOOL,
      label: 'Conversation auto control',
      description:
        'Control conversation auto mode from hidden auto-review turns. Only available in Nudge mode. Prefer continuing while useful work remains.',
      promptSnippet: 'Decide whether conversation auto mode should continue or stop.',
      promptGuidelines: [
        'Use this tool only during hidden auto-review turns for conversation nudge auto mode.',
        'The user enabled nudge mode because they want you to keep working without waiting for approval when progress is obvious.',
        'Use action "continue" when meaningful work remains.',
        'Use action "stop" only when the task is complete for the user\'s request, blocked on a real dependency, or needs user input.',
        'If no explicit validation target was given, infer the expected level of doneness from the prompt and work so far.',
      ],
      parameters: ConversationAutoControlParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const sessionId = ctx.sessionManager.getSessionId?.()?.trim();
        const state = readState(ctx);

        if (!isAutoModeHiddenReviewTurn(ctx.sessionManager)) {
          throw new Error('conversation_auto_control is only available during hidden auto-review turns.');
        }

        if (params.action === 'continue') {
          if (!sessionId) {
            throw new Error('Conversation auto mode requires a persisted live session.');
          }
          if (state.mode !== 'nudge') {
            return {
              content: [{ type: 'text' as const, text: 'Nudge mode is off, so no continuation was queued.' }],
              details: { mode: state.mode, action: 'continue' },
            };
          }

          markConversationAutoModeContinueRequested(sessionId);
          return {
            content: [{ type: 'text' as const, text: 'Nudge mode will continue after this hidden review turn.' }],
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
            updatedAt: nextState.updatedAt,
          },
        };
      },
    });

    // ── Register run_state tool (mission/loop modes only) ───────────────
    pi.registerTool({
      name: RUN_STATE_TOOL,
      label: 'Run state',
      description:
        'Read or update the current mission/loop state. Only available when a mission or loop is active. Use "get" to read tasks, "update_tasks" to mark tasks done, add new tasks, or reorder.',
      promptSnippet: 'Read or update the mission task list or loop state.',
      promptGuidelines: [
        'This tool is available because a Mission or Loop is active.',
        'Use action="get" at the start of each turn to read current state.',
        'Use action="update_tasks" to mark tasks done, add new tasks, or update descriptions.',
        'Do not remove tasks unless they are genuinely irrelevant. Prefer marking them "done" or "blocked".',
        'When adding tasks, include a clear description so the user can understand the task list.',
      ],
      parameters: RunStateParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const mode = readMode(ctx);
        const state = readState(ctx);

        if (params.action === 'get') {
          if (mode !== 'mission' && mode !== 'loop') {
            return {
              content: [{ type: 'text' as const, text: 'No active mission or loop.' }],
              details: { mode },
            };
          }
          if (mode === 'mission' && state.mission) {
            const tasksText = state.mission.tasks
              .map((t, i) => `${i + 1}. [${t.status === 'done' ? 'x' : ' '}] ${t.description} (${t.status})`)
              .join('\n');
            return {
              content: [
                {
                  type: 'text' as const,
                  text: [
                    `Mission: ${state.mission.goal}`,
                    `Tasks: ${state.mission.tasks.filter((t) => t.status === 'done').length}/${state.mission.tasks.length}`,
                    `Turns used: ${state.mission.turnsUsed}/${state.mission.maxTurns}`,
                    '',
                    tasksText,
                  ].join('\n'),
                },
              ],
              details: { mode, mission: state.mission },
            };
          }

          if (mode === 'loop' && state.loop) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: [
                    `Loop: ${state.loop.prompt}`,
                    `Iterations: ${state.loop.iterationsUsed}/${state.loop.maxIterations}`,
                    `Delay: ${state.loop.delay}`,
                  ].join('\n'),
                },
              ],
              details: { mode, loop: state.loop },
            };
          }

          return {
            content: [{ type: 'text' as const, text: 'No active mission or loop.' }],
            details: { mode },
          };
        }

        if (params.action === 'update_tasks') {
          if (mode !== 'mission') {
            throw new Error('update_tasks is only available in Mission mode.');
          }
          if (!state.mission) {
            throw new Error('No active mission to update tasks on.');
          }

          const patches = params.tasks ?? [];
          const tasks = [...state.mission.tasks];

          for (const patch of patches) {
            if (patch.id) {
              const existing = tasks.find((t) => t.id === patch.id);
              if (existing) {
                if (patch.status) existing.status = patch.status;
                if (patch.description) existing.description = patch.description;
              }
            } else if (patch.description) {
              tasks.push(createTask(patch.description, patch.status));
            }
          }

          writeConversationAutoModeState(ctx.sessionManager, {
            enabled: true,
            mode: 'mission',
            mission: { ...state.mission, tasks },
          });

          return {
            content: [
              {
                type: 'text' as const,
                text: `Updated task list. ${tasks.filter((t) => t.status === 'done').length}/${tasks.length} tasks done.`,
              },
            ],
            details: { mode: 'mission', tasks: tasks.map((t) => ({ id: t.id, status: t.status })) },
          };
        }

        return {
          content: [{ type: 'text' as const, text: 'Unknown action.' }],
        };
      },
    });

    // ── Turn end: schedule next continuation per mode ───────────────────
    pi.on('turn_end', async (_event, ctx) => {
      const sessionId = ctx.sessionManager.getSessionId?.()?.trim();
      const sessionFile = ctx.sessionManager.getSessionFile?.()?.trim();

      if (!sessionId && !sessionFile) {
        return;
      }

      const state = readState(ctx);
      if (!state.enabled) {
        return;
      }

      // Never schedule continuation from inside a hidden turn
      if (isAutoModeHiddenReviewTurn(ctx.sessionManager)) {
        return;
      }

      const mode = state.mode;

      if (mode === 'nudge' && isContinuationTurn(ctx.sessionManager)) {
        return;
      }

      if (mode === 'mission') {
        handleMissionTurnEnd(ctx, state, sessionId);
      } else if (mode === 'loop') {
        handleLoopTurnEnd(ctx, state, sessionId);
      } else if (mode === 'nudge') {
        handleNudgeTurnEnd(state, sessionId, sessionFile);
      }
    });
  };
}

// ── Mode-specific handlers ────────────────────────────────────────────────────

function handleNudgeTurnEnd(state: ConversationAutoModeState, sessionId: string | undefined, sessionFile: string | undefined): void {
  if (!state.enabled) {
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
      logWarn('nudge mode turn_end request failed', {
        sessionId,
        sessionFile,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });
}

function handleMissionTurnEnd(
  ctx: { sessionManager: { appendCustomEntry: (type: string, data: unknown) => string; getEntries: () => unknown[] } },
  state: ConversationAutoModeState,
  sessionId: string | undefined,
): void {
  const mission = state.mission;
  if (!mission) {
    return;
  }

  // Structural check: are all tasks done?
  if (areAllTasksDone(mission.tasks)) {
    return;
  }

  // Not all done — increment turns
  const nextTurnsUsed = mission.turnsUsed + 1;
  if (nextTurnsUsed >= mission.maxTurns) {
    logWarn('mission mode hit max turns', { sessionId, turnsUsed: nextTurnsUsed, maxTurns: mission.maxTurns });
    return;
  }

  // Update turnsUsed in state
  writeConversationAutoModeState(ctx.sessionManager, {
    ...state,
    mission: { ...mission, turnsUsed: nextTurnsUsed },
  });

  // Signal continuation via direct call (bypasses pendingAutoModeContinuation flag)
  if (sessionId) {
    queueMicrotask(() => {
      void requestConversationAutoModeContinuationTurn(sessionId).catch((error) => {
        logWarn('mission mode direct continuation failed', {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }
}

function parseLoopDelayMs(delay: string): number {
  const trimmed = delay.trim().toLowerCase();
  if (!trimmed || trimmed === 'after each turn' || trimmed === 'immediate') {
    return 0;
  }

  const match =
    /^(\d+(?:\.\d+)?)\s*(ms|millisecond|milliseconds|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/.exec(
      trimmed,
    );
  if (!match) {
    return 0;
  }

  const value = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  if (unit.startsWith('ms') || unit.startsWith('millisecond')) return value;
  if (unit === 's' || unit.startsWith('sec')) return value * 1000;
  if (unit === 'm' || unit.startsWith('min')) return value * 60_000;
  return value * 60 * 60_000;
}

function handleLoopTurnEnd(
  ctx: { sessionManager: { appendCustomEntry: (type: string, data: unknown) => string; getEntries: () => unknown[] } },
  state: ConversationAutoModeState,
  sessionId: string | undefined,
): void {
  const loop = state.loop;
  if (!loop) {
    return;
  }

  // Counter check
  if (loop.iterationsUsed >= loop.maxIterations) {
    return;
  }

  // Increment and update state
  const nextIterationsUsed = loop.iterationsUsed + 1;
  writeConversationAutoModeState(ctx.sessionManager, {
    ...state,
    loop: { ...loop, iterationsUsed: nextIterationsUsed },
  });

  // Signal continuation via direct call (bypasses pendingAutoModeContinuation flag)
  if (sessionId) {
    const requestContinuation = () => {
      void requestConversationAutoModeContinuationTurn(sessionId).catch((error) => {
        logWarn('loop mode direct continuation failed', {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    };
    const delayMs = parseLoopDelayMs(loop.delay);
    if (delayMs > 0) {
      setTimeout(requestContinuation, delayMs);
    } else {
      queueMicrotask(requestContinuation);
    }
  }
}
