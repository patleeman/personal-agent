import { Type } from '@sinclair/typebox';
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { emitDaemonEvent } from '@personal-agent/daemon';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STATUS_KEY = 'deferred-resume';
const STATUS_REFRESH_MS = 3_000;
const DEFAULT_PROMPT = 'Continue from where you left off and keep going.';
const GATEWAY_RUNTIME_CONTEXT_SYMBOL = Symbol.for('personal-agent.gateway.runtime-context');

interface DeferredResumeEntry {
  sessionFile: string;
}

interface GatewayRuntimeContext {
  provider: 'telegram' | 'discord';
  conversationId: string;
}

function resolveStateRoot(): string {
  if (process.env.PERSONAL_AGENT_STATE_ROOT) {
    return process.env.PERSONAL_AGENT_STATE_ROOT;
  }

  if (process.env.XDG_STATE_HOME) {
    return join(process.env.XDG_STATE_HOME, 'personal-agent');
  }

  return join(homedir(), '.local', 'state', 'personal-agent');
}

function resolveGatewayDeferredResumeStateFile(): string {
  return join(resolveStateRoot(), 'daemon', 'deferred-followups-state.json');
}

function resolveSessionDeferredResumeStateFile(): string {
  return join(resolveStateRoot(), 'daemon', 'session-deferred-resumes-state.json');
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

  if ((candidate.provider !== 'telegram' && candidate.provider !== 'discord') || !candidate.conversationId?.trim()) {
    return undefined;
  }

  return candidate;
}

export function loadDeferredResumeEntries(stateFile = resolveGatewayDeferredResumeStateFile()): DeferredResumeEntry[] {
  if (!existsSync(stateFile)) {
    return [];
  }

  try {
    const raw = readFileSync(stateFile, 'utf-8').trim();
    if (raw.length === 0) {
      return [];
    }

    const parsed = JSON.parse(raw) as {
      followUps?: Record<string, Record<string, unknown>>;
      resumes?: Record<string, Record<string, unknown>>;
    };
    const records = parsed.followUps ?? parsed.resumes;
    if (!records || typeof records !== 'object') {
      return [];
    }

    const entries: DeferredResumeEntry[] = [];
    for (const value of Object.values(records)) {
      const sessionFile = typeof value.sessionFile === 'string' ? value.sessionFile.trim() : '';
      if (!sessionFile) {
        continue;
      }

      entries.push({ sessionFile });
    }

    return entries;
  } catch {
    return [];
  }
}

function loadAllDeferredResumeEntries(): DeferredResumeEntry[] {
  return [
    ...loadDeferredResumeEntries(resolveGatewayDeferredResumeStateFile()),
    ...loadDeferredResumeEntries(resolveSessionDeferredResumeStateFile()),
  ];
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

  const entries = loadAllDeferredResumeEntries();
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

function buildGuidanceLines(ctx: ExtensionContext): string[] {
  const gatewayRuntimeContext = getGatewayRuntimeContext(ctx.sessionManager as object);

  const lines = [
    'DEFERRED_RESUME_GUIDANCE',
    '- You can schedule this same durable session to resume later with the deferred_resume tool.',
    '- Use deferred_resume when you should pause now and continue later after waiting for time to pass or for background work to make progress.',
    '- Do not ask the user to come back later manually when you can schedule the resume yourself.',
    '- Use delays like 30s, 10m, 2h, or 1d.',
    '- Provide a concise future prompt describing exactly what to continue or check next.',
  ];

  if (gatewayRuntimeContext) {
    lines.push('- In gateway conversations, deferred_resume wakes this same Telegram/Discord conversation on the same durable session.');
  } else {
    lines.push('- In non-gateway sessions, deferred_resume resumes the same persisted session file in the background.');
  }

  return lines;
}

export default function deferredResumeExtension(pi: ExtensionAPI): void {
  let statusTimer: ReturnType<typeof setInterval> | null = null;

  const startStatusTimer = async (ctx: ExtensionContext): Promise<void> => {
    await refreshStatus(ctx);

    if (statusTimer) {
      clearInterval(statusTimer);
    }

    statusTimer = setInterval(() => {
      void refreshStatus(ctx);
    }, STATUS_REFRESH_MS);
  };

  pi.registerTool({
    name: 'deferred_resume',
    label: 'Deferred Resume',
    description:
      'Schedule this same durable session to resume later. In gateway conversations it wakes the same Telegram/Discord thread; in other persisted sessions it continues the same session file in the background.',
    promptSnippet: 'Schedule this same durable session to resume later.',
    promptGuidelines: [
      'Use this tool when you want the agent to wake this same work back up later without waiting for the user to message again.',
      'Good uses: checking back after tmux/background work, waiting for time to pass, or continuing unattended multi-stage work later.',
      'Do not use this for immediate continuation; answer normally or use regular follow-ups instead.',
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
      const gatewayRuntimeContext = getGatewayRuntimeContext(ctx.sessionManager as object);

      try {
        const accepted = gatewayRuntimeContext
          ? await emitDaemonEvent({
            type: 'gateway.deferred-followup.schedule',
            source: 'extension:deferred-resume',
            payload: {
              gateway: gatewayRuntimeContext.provider,
              conversationId: gatewayRuntimeContext.conversationId,
              sessionFile,
              prompt,
              dueAt,
            },
          })
          : await emitDaemonEvent({
            type: 'session.deferred-resume.schedule',
            source: 'extension:deferred-resume',
            payload: {
              sessionFile,
              cwd: ctx.cwd,
              profile: process.env.PERSONAL_AGENT_ACTIVE_PROFILE,
              prompt,
              dueAt,
            },
          });

        if (!accepted) {
          return {
            content: [{ type: 'text' as const, text: 'Deferred resume was rejected because the daemon queue is full.' }],
            isError: true,
            details: { reason: 'daemon-queue-full' },
          };
        }

        await refreshStatus(ctx);

        return {
          content: [{ type: 'text' as const, text: `Scheduled deferred resume in ${delay} (due ${dueAt}).` }],
          details: gatewayRuntimeContext
            ? {
              mode: 'gateway',
              provider: gatewayRuntimeContext.provider,
              conversationId: gatewayRuntimeContext.conversationId,
              sessionFile,
              prompt,
              dueAt,
            }
            : {
              mode: 'session',
              sessionFile,
              cwd: ctx.cwd,
              profile: process.env.PERSONAL_AGENT_ACTIVE_PROFILE,
              prompt,
              dueAt,
            },
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Failed to schedule deferred resume: ${(error as Error).message}` }],
          isError: true,
          details: { reason: 'daemon-error', message: (error as Error).message },
        };
      }
    },
  });

  pi.on('before_agent_start', (event, ctx) => {
    const systemPrompt = event.systemPrompt?.trim();
    if (!systemPrompt) {
      return;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildGuidanceLines(ctx).join('\n')}`,
    };
  });

  pi.on('session_start', async (_event, ctx) => {
    await startStatusTimer(ctx);
  });

  pi.on('session_switch', async (_event, ctx) => {
    await startStatusTimer(ctx);
  });

  pi.on('turn_end', async (_event, ctx) => {
    await refreshStatus(ctx);
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    if (statusTimer) {
      clearInterval(statusTimer);
      statusTimer = null;
    }

    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  });
}
