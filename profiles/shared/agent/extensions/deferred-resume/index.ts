import { Type } from '@sinclair/typebox';
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import {
  activateDueDeferredResumes,
  getDueScheduledSessionDeferredResumeEntries,
  getReadySessionDeferredResumeEntries,
  getSessionDeferredResumeEntries,
  loadDeferredResumeEntries as loadDeferredResumeEntriesFromCore,
  loadDeferredResumeState,
  removeDeferredResume,
  resolveDeferredResumeStateFile as resolveDeferredResumeStateFileFromCore,
  retryDeferredResume,
  saveDeferredResumeState,
  scheduleDeferredResume,
  type DeferredResumeRecord,
} from '@personal-agent/core';

const STATUS_KEY = 'deferred-resume';
const HEARTBEAT_MS = 3_000;
const RETRY_DELAY_MS = 30_000;
const DEFAULT_PROMPT = 'Continue from where you left off and keep going.';
const GATEWAY_RUNTIME_CONTEXT_SYMBOL = Symbol.for('personal-agent.gateway.runtime-context');

interface DeferredResumeEntry {
  sessionFile: string;
}

interface GatewayRuntimeContext {
  provider: 'telegram';
  conversationId: string;
}

function createId(): string {
  return `resume_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseDelayMs(raw: string): number | undefined {
  const match = raw.trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!match) {
    return undefined;
  }

  const value = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  switch (unit) {
    case 's':
      return value * 1_000;
    case 'm':
      return value * 60_000;
    case 'h':
      return value * 60 * 60_000;
    case 'd':
      return value * 24 * 60 * 60_000;
    default:
      return undefined;
  }
}

function getGatewayRuntimeContext(sessionManager: object): GatewayRuntimeContext | undefined {
  const candidate = (sessionManager as {
    [GATEWAY_RUNTIME_CONTEXT_SYMBOL]?: GatewayRuntimeContext;
  })[GATEWAY_RUNTIME_CONTEXT_SYMBOL];

  if (!candidate) {
    return undefined;
  }

  if (candidate.provider !== 'telegram' || !candidate.conversationId?.trim()) {
    return undefined;
  }

  return candidate;
}

function formatDueIn(dueAt: string): string {
  const deltaMs = Date.parse(dueAt) - Date.now();
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return 'now';
  }

  const totalSeconds = Math.floor(deltaMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m${seconds}s`;
  }

  return `${seconds}s`;
}

function buildListLines(entries: DeferredResumeRecord[]): string[] {
  if (entries.length === 0) {
    return ['Deferred resumes: none queued.'];
  }

  const lines = [`Deferred resumes (${entries.length}):`];

  for (const entry of entries) {
    const stateSuffix = entry.status === 'ready' ? ' · ready' : '';
    lines.push(`- ${entry.id} · due in ${formatDueIn(entry.dueAt)}${stateSuffix} · ${entry.prompt}`);
  }

  return lines;
}

export function resolveDeferredResumeStateFile(): string {
  return resolveDeferredResumeStateFileFromCore();
}

export function loadDeferredResumeEntries(stateFile = resolveDeferredResumeStateFile()): DeferredResumeEntry[] {
  return loadDeferredResumeEntriesFromCore(stateFile);
}

export function buildDeferredResumeStatusText(input: {
  totalCount: number;
  currentSessionCount: number;
  theme: { fg: (tone: string, text: string) => string };
}): string {
  const { totalCount, currentSessionCount, theme } = input;

  if (currentSessionCount > 0) {
    return theme.fg('warning', '⏰') + theme.fg('warning', ` resume:${currentSessionCount}*`);
  }

  if (totalCount > 0) {
    return theme.fg('accent', '⏰') + theme.fg('dim', ` resume:${totalCount}`);
  }

  return theme.fg('dim', '⏰ resume:0');
}

async function refreshStatus(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    return;
  }

  const entries = loadDeferredResumeEntries();
  const currentSessionFile = ctx.sessionManager.getSessionFile();
  const currentSessionCount = currentSessionFile
    ? entries.filter((entry) => entry.sessionFile === currentSessionFile).length
    : 0;

  ctx.ui.setStatus(STATUS_KEY, buildDeferredResumeStatusText({
    totalCount: entries.length,
    currentSessionCount,
    theme: ctx.ui.theme,
  }));
}

export default function deferredResumeExtension(pi: ExtensionAPI): void {
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let processingDueResumes = false;

  const isGatewayMode = process.env.PERSONAL_AGENT_GATEWAY_MODE === '1';

  const clearHeartbeat = (): void => {
    if (!heartbeatTimer) {
      return;
    }

    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  const deliverDueResume = async (ctx: ExtensionContext): Promise<void> => {
    if (processingDueResumes) {
      return;
    }

    if (isGatewayMode || getGatewayRuntimeContext(ctx.sessionManager as object)) {
      return;
    }

    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) {
      return;
    }

    processingDueResumes = true;

    try {
      const state = loadDeferredResumeState();
      let entry = getReadySessionDeferredResumeEntries(state, sessionFile)[0];

      if (!entry) {
        const scheduledDueEntries = getDueScheduledSessionDeferredResumeEntries(state, sessionFile);
        if (scheduledDueEntries.length > 0) {
          const activated = activateDueDeferredResumes(state, {
            at: new Date(),
            sessionFile,
          });

          if (activated.length > 0) {
            saveDeferredResumeState(state);
          }

          entry = activated[0] ?? getReadySessionDeferredResumeEntries(state, sessionFile)[0];
        }
      }

      if (!entry) {
        await refreshStatus(ctx);
        return;
      }

      try {
        if (ctx.isIdle()) {
          pi.sendUserMessage(entry.prompt);
        } else {
          pi.sendUserMessage(entry.prompt, { deliverAs: 'followUp' });
        }

        removeDeferredResume(state, entry.id);
        saveDeferredResumeState(state);
      } catch {
        retryDeferredResume(state, {
          id: entry.id,
          dueAt: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
        });
        saveDeferredResumeState(state);
      }

      await refreshStatus(ctx);
    } finally {
      processingDueResumes = false;
    }
  };

  const startHeartbeat = async (ctx: ExtensionContext): Promise<void> => {
    clearHeartbeat();

    await refreshStatus(ctx);
    await deliverDueResume(ctx);

    heartbeatTimer = setInterval(() => {
      void deliverDueResume(ctx);
      void refreshStatus(ctx);
    }, HEARTBEAT_MS);
  };

  if (!isGatewayMode) {
    pi.registerTool({
      name: 'deferred_resume',
      label: 'Deferred Resume',
      description:
        'Schedule this same TUI session to continue later. Due prompts are queued into the currently open session (not a background process).',
      promptSnippet: 'Schedule this same TUI session to resume later.',
      promptGuidelines: [
        'Use this tool when you want to pause now and continue this same TUI session later.',
        'Good uses: waiting for time to pass, waiting before checking background progress, or staging unattended multi-step work.',
        'This is TUI-only and does not run hidden background session writers.',
        'Use delays like 30s, 10m, 2h, or 1d.',
        'Provide a concise future prompt describing what to do when resumed.',
      ],
      parameters: Type.Object({
        delay: Type.String({
          description: 'Delay until resume, for example 30s, 10m, 2h, or 1d.',
        }),
        prompt: Type.Optional(Type.String({
          description: 'Optional prompt to inject when the deferred resume triggers. Defaults to continuing from the current point.',
        })),
      }),

      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        if (!ctx.hasUI) {
          return {
            content: [{ type: 'text' as const, text: 'Deferred resume is only available in interactive TUI sessions.' }],
            isError: true,
            details: { reason: 'missing-ui' },
          };
        }

        if (getGatewayRuntimeContext(ctx.sessionManager as object)) {
          return {
            content: [{ type: 'text' as const, text: 'Deferred resume is disabled in gateway conversations.' }],
            isError: true,
            details: { reason: 'gateway-disabled' },
          };
        }

        const sessionFile = ctx.sessionManager.getSessionFile();
        if (!sessionFile) {
          return {
            content: [{ type: 'text' as const, text: 'Deferred resume requires a persisted session file.' }],
            isError: true,
            details: { reason: 'missing-session-file' },
          };
        }

        const delay = params.delay.trim();
        const delayMs = parseDelayMs(delay);
        if (!delayMs) {
          return {
            content: [{ type: 'text' as const, text: 'Invalid delay. Use forms like 30s, 10m, 2h, or 1d.' }],
            isError: true,
            details: { reason: 'invalid-delay', delay },
          };
        }

        const prompt = (params.prompt ?? '').trim() || DEFAULT_PROMPT;
        const dueAt = new Date(Date.now() + delayMs).toISOString();

        const state = loadDeferredResumeState();
        const id = createId();

        scheduleDeferredResume(state, {
          id,
          sessionFile,
          prompt,
          dueAt,
          createdAt: new Date().toISOString(),
          attempts: 0,
        });

        saveDeferredResumeState(state);
        await refreshStatus(ctx);

        return {
          content: [{ type: 'text' as const, text: `Scheduled deferred resume ${id} in ${delay} (due ${dueAt}).` }],
          details: {
            mode: 'tui',
            id,
            sessionFile,
            prompt,
            dueAt,
          },
        };
      },
    });

    pi.registerCommand('deferred', {
      description: 'List or cancel queued TUI deferred resumes. Usage: /deferred [all|cancel <id>|cancel all]',
      handler: async (args, ctx) => {
        const sessionFile = ctx.sessionManager.getSessionFile();
        if (!sessionFile) {
          ctx.ui.notify('Deferred resumes require a persisted session file.', 'warning');
          return;
        }

        const tokens = args.trim().split(/\s+/).filter((token) => token.length > 0);
        const state = loadDeferredResumeState();

        if (tokens[0] === 'cancel') {
          const target = tokens[1];
          if (!target) {
            ctx.ui.notify('Usage: /deferred cancel <id|all>', 'warning');
            return;
          }

          if (target === 'all') {
            const beforeCount = Object.keys(state.resumes).length;
            for (const entry of Object.values(state.resumes)) {
              if (entry.sessionFile === sessionFile) {
                removeDeferredResume(state, entry.id);
              }
            }

            const afterCount = Object.keys(state.resumes).length;
            saveDeferredResumeState(state);
            await refreshStatus(ctx);
            ctx.ui.notify(`Cancelled ${beforeCount - afterCount} deferred resume(s) for this session.`, 'info');
            return;
          }

          const entry = state.resumes[target];
          if (!entry || entry.sessionFile !== sessionFile) {
            ctx.ui.notify(`No deferred resume found for this session: ${target}`, 'warning');
            return;
          }

          removeDeferredResume(state, target);
          saveDeferredResumeState(state);
          await refreshStatus(ctx);
          ctx.ui.notify(`Cancelled deferred resume ${target}.`, 'info');
          return;
        }

        if (tokens[0] && tokens[0] !== 'all') {
          ctx.ui.notify('Usage: /deferred [all|cancel <id>|cancel all]', 'warning');
          return;
        }

        const entries = tokens[0] === 'all'
          ? Object.values(state.resumes).sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt))
          : getSessionDeferredResumeEntries(state, sessionFile);

        ctx.ui.notify(buildListLines(entries).join('\n'), 'info');
      },
    });
  }

  pi.on('before_agent_start', (event, ctx) => {
    if (isGatewayMode || getGatewayRuntimeContext(ctx.sessionManager as object)) {
      return;
    }

    const systemPrompt = event.systemPrompt?.trim();
    if (!systemPrompt) {
      return;
    }

    const lines = [
      'DEFERRED_RESUME_GUIDANCE',
      '- You can schedule this same TUI session to resume later with the deferred_resume tool.',
      '- Use deferred_resume when you should pause now and continue later after waiting for time to pass or for background work to make progress.',
      '- Deferred resumes queue into this same live session instead of spawning a background process that writes to the session file.',
      '- If this session is closed when due, the prompt runs the next time this session is opened.',
      '- Use delays like 30s, 10m, 2h, or 1d.',
      '- Provide a concise future prompt describing exactly what to continue or check next.',
    ];

    return {
      systemPrompt: `${event.systemPrompt}\n\n${lines.join('\n')}`,
    };
  });

  pi.on('session_start', async (_event, ctx) => {
    await startHeartbeat(ctx);
  });

  pi.on('session_switch', async (_event, ctx) => {
    await startHeartbeat(ctx);
  });

  pi.on('turn_end', async (_event, ctx) => {
    await deliverDueResume(ctx);
    await refreshStatus(ctx);
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    clearHeartbeat();

    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  });
}
