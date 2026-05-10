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
}

const DEFAULT_GOAL_STATE: GoalState = {
  objective: '',
  status: 'complete',
  tasks: [],
  stopReason: null,
  updatedAt: null,
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
    };
  }
  return DEFAULT_GOAL_STATE;
}

function writeGoalState(pi: ExtensionAPI, state: GoalState): void {
  pi.appendEntry(GOAL_STATE_CUSTOM_TYPE, state);
}

const GOAL_ACTIVE_TOOLS = [GOAL_UPDATE_TOOL];
const GOAL_INACTIVE_TOOLS = [GOAL_SET_TOOL];
const GOAL_TOOLS = [...GOAL_ACTIVE_TOOLS, ...GOAL_INACTIVE_TOOLS];

function syncGoalTools(pi: ExtensionAPI, hasActiveGoal: boolean): void {
  const current = pi.getActiveTools().filter((tool) => !GOAL_TOOLS.includes(tool));
  pi.setActiveTools([...current, ...(hasActiveGoal ? GOAL_ACTIVE_TOOLS : GOAL_INACTIVE_TOOLS)]);
}

function buildContinuationPrompt(state: GoalState): string {
  return [
    'Goal continuation.',
    '',
    `Objective: ${state.objective}`,
    '',
    'Continue working until the objective is fully achieved.',
    'Do not mark the goal complete or stop early.',
    'Do not mention this hidden continuation prompt.',
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
    // Track consecutive turns that did not use tools so goal mode cannot spin forever on chat-only continuations.
    let continuationSuppressed = false;
    let consecutiveNoToolTurns = 0;

    // ── Register set_goal tool ───────────────────────────────────────────
    pi.registerTool({
      name: GOAL_SET_TOOL,
      label: 'Set goal',
      description: 'Set a goal for this conversation when goal mode is not already active.',
      promptSnippet: 'Set a concrete objective to work toward.',
      promptGuidelines: [
        'Use this tool only when the user explicitly asks you to start goal mode from a normal conversation.',
        'If a goal is already active, use update_goal to change the objective or mark it complete.',
        'Do not create a goal for every ordinary request — only for sustained multi-turn tasks.',
      ],
      parameters: SetGoalParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const state = readGoalState(ctx.sessionManager);
        if (state.status === 'active') {
          throw new Error('A goal is already active. Mark it complete first with update_goal.');
        }

        const objective = params.objective.trim();
        if (!objective) {
          throw new Error('Goal objective cannot be empty.');
        }

        const newState: GoalState = {
          objective,
          status: 'active',
          tasks: [],
          stopReason: null,
          updatedAt: new Date().toISOString(),
        };
        writeGoalState(pi, newState);
        syncGoalTools(pi, true);
        continuationSuppressed = false;
        consecutiveNoToolTurns = 0;

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
      promptSnippet: 'Update the goal when the objective changes, or mark it achieved when done.',
      promptGuidelines: [
        'Use objective to replace the active goal text when the target changes.',
        'Use status: "complete" only when the objective is actually achieved.',
        'Do not mark it complete just because you are stopping work.',
      ],
      parameters: UpdateGoalParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const state = readGoalState(ctx.sessionManager);
        if (state.status !== 'active') {
          throw new Error('No active goal to update.');
        }

        const objective = typeof params.objective === 'string' ? params.objective.trim() : undefined;
        if (params.status !== 'complete' && !objective) {
          throw new Error('Provide objective to update the goal, or status: "complete" to finish it.');
        }

        const newState: GoalState = {
          ...state,
          objective: objective || state.objective,
          status: params.status === 'complete' ? 'complete' : 'active',
          stopReason: params.status === 'complete' ? 'goal achieved' : null,
          updatedAt: new Date().toISOString(),
        };
        writeGoalState(pi, newState);
        syncGoalTools(pi, newState.status === 'active');
        continuationSuppressed = false;
        consecutiveNoToolTurns = 0;

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
          const cleared: GoalState = {
            objective: '',
            status: 'complete',
            tasks: [],
            stopReason: 'cleared',
            updatedAt: new Date().toISOString(),
          };
          writeGoalState(pi, cleared);
          syncGoalTools(pi, false);
          continuationSuppressed = false;
          consecutiveNoToolTurns = 0;
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
        const newState: GoalState = {
          objective: trimmed,
          status: 'active',
          tasks: [],
          stopReason: null,
          updatedAt: new Date().toISOString(),
        };
        writeGoalState(pi, newState);
        syncGoalTools(pi, true);
        continuationSuppressed = false;
        consecutiveNoToolTurns = 0;
        pi.sendUserMessage(`Goal set: ${trimmed}`);
      },
    });

    // ── Turn end: schedule continuation if goal is active ──────────────
    pi.on('turn_end', async (event, ctx) => {
      const state = readGoalState(ctx.sessionManager);
      if (state.status !== 'active') {
        continuationSuppressed = false;
        consecutiveNoToolTurns = 0;
        return;
      }

      // Pause goal on interrupt (user hit stop mid-stream)
      if (ctx.signal?.aborted) {
        const paused: GoalState = { ...state, status: 'paused', updatedAt: new Date().toISOString() };
        writeGoalState(pi, paused);
        syncGoalTools(pi, false);
        continuationSuppressed = false;
        consecutiveNoToolTurns = 0;
        return;
      }

      const toolResults = Array.isArray(event.toolResults) ? event.toolResults : [];
      if (isNoProgressGoalTurn(toolResults)) {
        consecutiveNoToolTurns += 1;
      } else {
        consecutiveNoToolTurns = 0;
        continuationSuppressed = false;
      }

      if (consecutiveNoToolTurns >= 2) {
        continuationSuppressed = true;
        return;
      }

      // No-tool suppression: if recent continuation turns did nothing, skip next
      if (continuationSuppressed) {
        return;
      }

      // Check if model has pending messages (user or system input waiting)
      if (ctx.hasPendingMessages()) {
        return;
      }

      const prompt = buildContinuationPrompt(state);
      const continuationId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      queueMicrotask(() => {
        pi.sendMessage(
          {
            customType: CONTINUATION_CUSTOM_TYPE,
            content: prompt,
            display: false,
            details: { source: 'goal-mode', continuationId },
          },
          { deliverAs: 'followUp', triggerTurn: true },
        );
      });
    });

    // Keep the event registered for diagnostics/compatibility; turn_end decides whether the full turn made progress.
    pi.on('tool_execution_end', () => {
      continuationSuppressed = false;
    });

    // ── Reactivate paused goal on resume ──────────────────────────────────
    pi.on('session_start', async (event, ctx) => {
      const state = readGoalState(ctx.sessionManager);
      syncGoalTools(pi, state.status === 'active');

      if (event.reason !== 'resume') {
        return;
      }

      if (state.status !== 'paused' || !state.objective) {
        return;
      }

      // Reactivate the paused goal
      const newState: GoalState = {
        ...state,
        status: 'active',
        updatedAt: new Date().toISOString(),
      };
      writeGoalState(pi, newState);
      syncGoalTools(pi, true);
      continuationSuppressed = false;
      consecutiveNoToolTurns = 0;
    });
  };
}
