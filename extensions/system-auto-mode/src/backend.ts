import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';

// ── Constants ────────────────────────────────────────────────────────────────

const GOAL_STATE_CUSTOM_TYPE = 'conversation-goal';
const CONTINUATION_CUSTOM_TYPE = 'goal-continuation';

const GOAL_SET_TOOL = 'set_goal';
const GOAL_UPDATE_TOOL = 'update_goal';

// ── State types ──────────────────────────────────────────────────────────────

interface GoalState {
  objective: string;
  status: 'active' | 'paused' | 'complete';
  tasks: [];
  stopReason: string | null;
  updatedAt: string | null;
  noProgressTurns: number;
}

const DEFAULT_GOAL_STATE: GoalState = {
  objective: '',
  status: 'complete',
  tasks: [],
  stopReason: null,
  updatedAt: null,
  noProgressTurns: 0,
};

// ── State helpers ────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readGoalState(sessionManager: { getEntries: () => unknown[] }): GoalState {
  const entries = sessionManager.getEntries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isRecord(entry) || entry.type !== 'custom' || entry.customType !== GOAL_STATE_CUSTOM_TYPE) {
      continue;
    }
    const data = entry.data;
    if (!isRecord(data) || typeof data.objective !== 'string') {
      continue;
    }
    const status =
      typeof data.status === 'string' && ['active', 'paused', 'complete'].includes(data.status)
        ? (data.status as GoalState['status'])
        : 'complete';
    return {
      objective: data.objective,
      status,
      tasks: [],
      stopReason: typeof data.stopReason === 'string' ? data.stopReason : null,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
      noProgressTurns: typeof data.noProgressTurns === 'number' && Number.isSafeInteger(data.noProgressTurns) ? data.noProgressTurns : 0,
    };
  }
  return DEFAULT_GOAL_STATE;
}

function writeGoalState(pi: ExtensionAPI, state: GoalState): void {
  pi.appendEntry(GOAL_STATE_CUSTOM_TYPE, state);
}

function createActiveGoalState(objective: string): GoalState {
  return {
    objective,
    status: 'active',
    tasks: [],
    stopReason: null,
    updatedAt: new Date().toISOString(),
    noProgressTurns: 0,
  };
}

function createCompleteGoalState(stopReason: string): GoalState {
  return {
    objective: '',
    status: 'complete',
    tasks: [],
    stopReason,
    updatedAt: new Date().toISOString(),
    noProgressTurns: 0,
  };
}

function buildContinuationPrompt(state: GoalState): string {
  return [
    'Goal continuation.',
    '',
    `Objective: ${state.objective}`,
    '',
    'Continue working until the objective is fully achieved.',
    'If the objective is fully achieved, call update_goal with status: "complete" and stop.',
    'If work remains, make concrete progress before replying.',
  ].join('\n');
}

function isNoProgressGoalTurn(toolResults: Array<{ toolName?: string }>): boolean {
  return toolResults.length === 0;
}

// ── Tool parameter schemas ───────────────────────────────────────────────────

const SetGoalParams = Type.Object({
  objective: Type.String({ description: 'The concrete objective to pursue.' }),
});

const UpdateGoalParams = Type.Object({
  status: Type.Optional(
    Type.Union([Type.Literal('complete')], {
      description: 'Mark the goal as complete only when the objective is achieved.',
    }),
  ),
  objective: Type.Optional(Type.String({ description: 'Replace the active goal objective when the goal has changed.' })),
});

// ── Extension entry ──────────────────────────────────────────────────────────

export function createConversationAutoModeAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    let pendingContinuationTimer: ReturnType<typeof setTimeout> | null = null;

    const clearPendingContinuation = () => {
      if (pendingContinuationTimer) {
        clearTimeout(pendingContinuationTimer);
        pendingContinuationTimer = null;
      }
    };

    // ── Register set_goal tool ───────────────────────────────────────────
    pi.registerTool({
      name: GOAL_SET_TOOL,
      label: 'Set goal',
      description: 'Enable goal mode with a concrete objective, or replace the active objective.',
      promptSnippet: 'Set a concrete objective to work toward.',
      promptGuidelines: [
        'Use goal mode only for explicit requests or sustained autonomous work; ordinary one-shot tasks do not need a goal.',
      ],
      parameters: SetGoalParams,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const objective = params.objective.trim();
        if (!objective) {
          throw new Error('Goal objective cannot be empty.');
        }

        const newState = createActiveGoalState(objective);
        writeGoalState(pi, newState);
        clearPendingContinuation();

        return {
          content: [
            {
              type: 'text' as const,
              text: `Goal set: "${objective}"`,
            },
          ],
          details: { state: newState },
        };
      },
    });

    // ── Register update_goal tool ───────────────────────────────────────
    pi.registerTool({
      name: GOAL_UPDATE_TOOL,
      label: 'Update goal',
      description: 'Update the current goal objective or mark it complete.',
      promptSnippet: 'Enable or update the goal when the objective changes, or mark it achieved when done.',
      promptGuidelines: ['Update the objective when the goal changes; use status="complete" only when the objective is actually achieved.'],
      parameters: UpdateGoalParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const state = readGoalState(ctx.sessionManager);
        const objective = typeof params.objective === 'string' ? params.objective.trim() : undefined;
        if (params.status !== 'complete' && !objective) {
          throw new Error('Provide objective to update the goal, or status: "complete" to finish it.');
        }

        if (params.status === 'complete' && state.status !== 'active') {
          clearPendingContinuation();
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Goal already complete.',
              },
            ],
            details: { state },
          };
        }

        const newState = params.status === 'complete' ? createCompleteGoalState('goal achieved') : createActiveGoalState(objective!);
        writeGoalState(pi, newState);
        clearPendingContinuation();

        const text = newState.status === 'complete' ? 'Goal complete!' : `Goal updated: "${newState.objective}"`;
        return {
          content: [
            {
              type: 'text' as const,
              text,
            },
          ],
          details: { state: newState },
        };
      },
    });

    // ── Register /goal slash command ────────────────────────────────────
    pi.registerCommand('goal', {
      description: 'Set, view, or clear the current goal. Usage: /goal <objective>, /goal, or /goal clear',
      async handler(args, ctx) {
        const trimmed = args.trim();

        if (trimmed.toLowerCase() === 'clear' || trimmed.toLowerCase() === 'c') {
          const state = readGoalState(ctx.sessionManager);
          if (!state.objective) {
            pi.sendUserMessage('No goal to clear.');
            return;
          }
          const cleared = createCompleteGoalState('cleared');
          writeGoalState(pi, cleared);
          clearPendingContinuation();
          pi.sendUserMessage(`Goal cleared. Previous objective: ${state.objective}`);
          return;
        }

        if (!trimmed) {
          const state = readGoalState(ctx.sessionManager);
          if (!state.objective) {
            pi.sendUserMessage('No goal is set. Use /goal <objective> to set one.');
            return;
          }
          pi.sendUserMessage(`Current goal: ${state.objective} (${state.status})`);
          return;
        }

        // Set a new goal
        const newState = createActiveGoalState(trimmed);
        writeGoalState(pi, newState);
        clearPendingContinuation();
        pi.sendUserMessage(`Goal set: ${trimmed}`);
      },
    });

    // ── Turn end: update progress state only ──────────────────────────
    pi.on('turn_end', async (event, ctx) => {
      const state = readGoalState(ctx.sessionManager);
      if (state.status !== 'active') {
        clearPendingContinuation();
        return;
      }

      // Pause goal on interrupt (user hit stop mid-stream)
      if (ctx.signal?.aborted) {
        const stopped = createCompleteGoalState('interrupted');
        writeGoalState(pi, stopped);
        clearPendingContinuation();
        return;
      }

      const toolResults = Array.isArray(event.toolResults) ? event.toolResults : [];
      const noProgressTurns = isNoProgressGoalTurn(toolResults) ? state.noProgressTurns + 1 : 0;
      if (noProgressTurns >= 2) {
        const stopped = createCompleteGoalState('no progress');
        writeGoalState(pi, stopped);
        clearPendingContinuation();
        return;
      }

      if (noProgressTurns !== state.noProgressTurns) {
        writeGoalState(pi, { ...state, noProgressTurns, updatedAt: new Date().toISOString() });
      }
    });

    // ── Agent end: schedule one continuation if goal is still active ───
    pi.on('agent_end', async (_event, ctx) => {
      const state = readGoalState(ctx.sessionManager);
      if (state.status !== 'active') {
        clearPendingContinuation();
        return;
      }

      // Check if model has pending messages (user or system input waiting)
      if (ctx.hasPendingMessages()) {
        return;
      }

      if (pendingContinuationTimer) {
        return;
      }

      const prompt = buildContinuationPrompt(state);
      const continuationId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const scheduledObjective = state.objective;
      const scheduledUpdatedAt = state.updatedAt;

      pendingContinuationTimer = setTimeout(() => {
        pendingContinuationTimer = null;
        const latest = readGoalState(ctx.sessionManager);
        if (latest.status !== 'active' || latest.objective !== scheduledObjective || latest.updatedAt !== scheduledUpdatedAt) {
          return;
        }
        if (ctx.hasPendingMessages()) {
          return;
        }
        pi.sendMessage(
          {
            customType: CONTINUATION_CUSTOM_TYPE,
            content: prompt,
            details: { source: 'goal-mode', continuationId },
          },
          { deliverAs: 'followUp', triggerTurn: true },
        );
      }, 0);
    });

    pi.on('session_start', async (_event, ctx) => {
      const state = readGoalState(ctx.sessionManager);
      if (state.status !== 'active') {
        clearPendingContinuation();
      }
    });
  };
}
