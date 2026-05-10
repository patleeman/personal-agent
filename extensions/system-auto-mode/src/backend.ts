import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';

// ── Constants ────────────────────────────────────────────────────────────────

const GOAL_STATE_CUSTOM_TYPE = 'conversation-goal';
const CONTINUATION_CUSTOM_TYPE = 'goal-continuation';

const GOAL_SET_TOOL = 'set_goal';
const GOAL_UPDATE_TOOL = 'update_goal';
const GOAL_GET_TOOL = 'get_goal';
const GOAL_UPDATE_TASKS_TOOL = 'update_tasks';

// ── State types ──────────────────────────────────────────────────────────────

interface Task {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
}

interface GoalState {
  objective: string;
  status: 'active' | 'paused' | 'complete';
  tasks: Task[];
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

function createTask(description: string, status?: Task['status']): Task {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, description, status: status ?? 'pending' };
}

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
    const tasks: Task[] = [];
    if (Array.isArray(data.tasks)) {
      for (const task of data.tasks) {
        if (!isRecord(task) || typeof task.id !== 'string' || typeof task.description !== 'string') {
          continue;
        }
        const taskStatus =
          typeof task.status === 'string' && ['pending', 'in_progress', 'done', 'blocked'].includes(task.status)
            ? (task.status as Task['status'])
            : 'pending';
        tasks.push({ id: task.id, description: task.description, status: taskStatus });
      }
    }
    return {
      objective: data.objective,
      status,
      tasks,
      stopReason: typeof data.stopReason === 'string' ? data.stopReason : null,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
    };
  }
  return DEFAULT_GOAL_STATE;
}

function writeGoalState(pi: ExtensionAPI, state: GoalState): void {
  pi.appendEntry(GOAL_STATE_CUSTOM_TYPE, state);
}

const GOAL_ACTIVE_TOOLS = [GOAL_UPDATE_TOOL, GOAL_UPDATE_TASKS_TOOL];

function syncGoalTools(pi: ExtensionAPI, hasActiveGoal: boolean): void {
  const current = pi.getActiveTools();
  const hasTools = current.includes(GOAL_UPDATE_TOOL);
  if (hasActiveGoal && !hasTools) {
    pi.setActiveTools([...current, ...GOAL_ACTIVE_TOOLS]);
  } else if (!hasActiveGoal && hasTools) {
    pi.setActiveTools(current.filter((t) => !GOAL_ACTIVE_TOOLS.includes(t)));
  }
}

function buildContinuationPrompt(state: GoalState): string {
  const taskLines = state.tasks.filter((t) => t.status !== 'done').map((t, i) => `${i + 1}. ${t.description} (${t.status})`);
  const taskSummary = taskLines.length > 0 ? `Remaining tasks:\n${taskLines.join('\n')}` : 'No remaining tasks.';
  return [
    'Goal continuation.',
    '',
    `Objective: ${state.objective}`,
    taskSummary,
    '',
    'Continue working until the objective is fully achieved.',
    'Do not mark the goal complete or stop early.',
    'Do not mention this hidden continuation prompt.',
  ].join('\n');
}

function isNoProgressGoalTurn(toolResults: Array<{ toolName?: string }>): boolean {
  return toolResults.length === 0 || toolResults.every((result) => result.toolName === GOAL_GET_TOOL);
}

// ── Tool parameter schemas ───────────────────────────────────────────────────

const SetGoalParams = Type.Object({
  objective: Type.String({ description: 'The concrete objective to pursue.' }),
  tasks: Type.Optional(
    Type.Array(
      Type.Object({
        description: Type.String({ description: 'Task description.' }),
      }),
      { description: 'Optional list of sub-tasks for the goal.' },
    ),
  ),
});

const UpdateGoalParams = Type.Object({
  status: Type.Union([Type.Literal('complete')], {
    description: 'Mark the goal as complete only when the objective is achieved.',
  }),
});

const UpdateTasksParams = Type.Object({
  tasks: Type.Array(
    Type.Object({
      id: Type.String({ description: 'Task id.' }),
      status: Type.Union([Type.Literal('pending'), Type.Literal('in_progress'), Type.Literal('done'), Type.Literal('blocked')], {
        description: 'New task status.',
      }),
    }),
  ),
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
      description: 'Set a goal for this conversation. Fails if a goal is already active — mark it complete first with update_goal.',
      promptSnippet: 'Set a concrete objective to work toward.',
      promptGuidelines: [
        'Use this tool when the user asks you to pursue a goal across multiple turns.',
        'Create clear, actionable objectives and split complex goals into tasks.',
        'If a goal already exists, use update_goal to mark it complete first.',
        'Do not create a goal for every ordinary request — only for sustained multi-turn tasks.',
      ],
      parameters: SetGoalParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const state = readGoalState(ctx.sessionManager);
        if (state.status === 'active') {
          throw new Error('A goal is already active. Mark it complete first with update_goal.');
        }

        const tasks = (params.tasks ?? []).map((t) => createTask(t.description));
        const newState: GoalState = {
          objective: params.objective,
          status: 'active',
          tasks,
          stopReason: null,
          updatedAt: new Date().toISOString(),
        };
        writeGoalState(pi, newState);
        syncGoalTools(pi, true);
        continuationSuppressed = false;
        consecutiveNoToolTurns = 0;

        const taskSummary = tasks.length > 0 ? `. Tasks: ${tasks.length}` : '';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Goal set: "${params.objective}"${taskSummary}`,
            },
          ],
          details: { state: newState },
        };
      },
    });

    // ── Register update_goal tool (complete only) ───────────────────────
    pi.registerTool({
      name: GOAL_UPDATE_TOOL,
      label: 'Update goal status',
      description: 'Mark the current goal as complete.',
      promptSnippet: 'Mark the goal achieved when the objective is met.',
      promptGuidelines: [
        'Only use this tool to mark the goal complete.',
        'Do not mark it complete just because you are stopping work — only when the objective is actually achieved.',
      ],
      parameters: UpdateGoalParams,
      async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
        const state = readGoalState(ctx.sessionManager);
        if (state.status !== 'active') {
          throw new Error('No active goal to complete.');
        }

        const newState: GoalState = {
          ...state,
          status: 'complete',
          stopReason: 'goal achieved',
          updatedAt: new Date().toISOString(),
        };
        writeGoalState(pi, newState);
        syncGoalTools(pi, false);
        continuationSuppressed = false;
        consecutiveNoToolTurns = 0;

        return {
          content: [
            {
              type: 'text' as const,
              text: 'Goal complete!',
            },
          ],
          details: { state: newState },
        };
      },
    });

    // ── Register get_goal tool ──────────────────────────────────────────
    pi.registerTool({
      name: GOAL_GET_TOOL,
      label: 'Get goal',
      description: 'Read the current goal, status, and tasks.',
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
        const state = readGoalState(ctx.sessionManager);
        if (!state.objective) {
          return {
            content: [{ type: 'text' as const, text: 'No goal is set.' }],
            details: { state: null },
          };
        }

        const taskLines = state.tasks.map((t, i) => `${i + 1}. [${t.status === 'done' ? 'x' : ' '}] ${t.description} (${t.status})`);
        const tasksText = taskLines.length > 0 ? `\nTasks:\n${taskLines.join('\n')}` : '';
        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Objective: ${state.objective}`,
                `Status: ${state.status}`,
                state.tasks.length > 0 ? `Tasks: ${state.tasks.filter((t) => t.status === 'done').length}/${state.tasks.length} done` : '',
                tasksText,
              ]
                .filter(Boolean)
                .join('\n'),
            },
          ],
          details: { state },
        };
      },
    });

    // ── Register update_tasks tool ──────────────────────────────────────
    pi.registerTool({
      name: GOAL_UPDATE_TASKS_TOOL,
      label: 'Update tasks',
      description: 'Update task statuses for the current goal.',
      promptSnippet: 'Keep the task list current as work progresses.',
      promptGuidelines: [
        'Update task status immediately when starting or finishing a task.',
        'Do not batch all updates at the end — keep the list current.',
        'Mark tasks "done" as soon as they are complete.',
      ],
      parameters: UpdateTasksParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const state = readGoalState(ctx.sessionManager);
        if (state.status !== 'active') {
          throw new Error('No active goal to update tasks for.');
        }

        const tasks = state.tasks.map((t) => {
          const patch = params.tasks.find((p) => p.id === t.id);
          if (patch) {
            return { ...t, status: patch.status };
          }
          return t;
        });

        const newState: GoalState = { ...state, tasks, updatedAt: new Date().toISOString() };
        writeGoalState(pi, newState);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Updated tasks. ${tasks.filter((t) => t.status === 'done').length}/${tasks.length} done.`,
            },
          ],
          details: { tasks: tasks.map((t) => ({ id: t.id, status: t.status })) },
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
          const taskSummary =
            state.tasks.length > 0 ? ` Tasks: ${state.tasks.filter((t) => t.status === 'done').length}/${state.tasks.length} done.` : '';
          pi.sendUserMessage(`Current goal: ${state.objective} (${state.status})${taskSummary}`);
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

    // After a continuation turn, track whether it produced tool calls.
    pi.on('tool_execution_end', () => {
      continuationSuppressed = false;
      consecutiveNoToolTurns = 0;
    });

    // ── Reactivate paused goal on resume ──────────────────────────────────
    pi.on('session_start', async (event, ctx) => {
      if (event.reason !== 'resume') {
        return;
      }

      const state = readGoalState(ctx.sessionManager);
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
