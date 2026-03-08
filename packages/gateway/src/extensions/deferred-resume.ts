import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { emitDaemonEvent } from '@personal-agent/daemon';
import { getGatewayExtensionRuntimeContext } from './runtime-context.js';

const DEFAULT_PROMPT = 'Continue from where you left off and keep going.';

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

export default function deferredResumeExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'deferred_resume',
    label: 'Deferred Resume',
    description:
      'Schedule this same gateway conversation to resume later on the same durable session. Use it when you should stop now and continue after waiting for time to pass or background work to progress.',
    promptSnippet: 'Schedule this same gateway conversation to resume later on the same session.',
    promptGuidelines: [
      'Use this tool when you want to wake this same conversation up later without asking the user to message again.',
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
      const runtimeContext = getGatewayExtensionRuntimeContext(ctx.sessionManager as object);
      if (!runtimeContext) {
        return {
          content: [{ type: 'text' as const, text: 'Deferred resume is only available in gateway-bound conversations.' }],
          isError: true,
          details: { reason: 'missing-gateway-context' },
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

      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        return {
          content: [{ type: 'text' as const, text: 'Deferred resume requires a persisted session file.' }],
          isError: true,
          details: { reason: 'missing-session-file' },
        };
      }

      const prompt = (params.prompt ?? '').trim() || DEFAULT_PROMPT;
      const dueAt = new Date(Date.now() + delayMs).toISOString();

      try {
        const accepted = await emitDaemonEvent({
          type: 'gateway.deferred-followup.schedule',
          source: 'gateway-extension:deferred-resume',
          payload: {
            gateway: runtimeContext.provider,
            conversationId: runtimeContext.conversationId,
            sessionFile,
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

        return {
          content: [{ type: 'text' as const, text: `Scheduled deferred resume in ${delay} (due ${dueAt}).` }],
          details: {
            provider: runtimeContext.provider,
            conversationId: runtimeContext.conversationId,
            sessionFile,
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
    const runtimeContext = getGatewayExtensionRuntimeContext(ctx.sessionManager as object);
    if (!runtimeContext) {
      return;
    }

    const systemPrompt = event.systemPrompt?.trim();
    if (!systemPrompt) {
      return;
    }

    const lines = [
      'DEFERRED_RESUME_GUIDANCE',
      '- You can schedule this same gateway conversation to resume later with the deferred_resume tool.',
      '- Use deferred_resume when you should pause now and continue later after waiting for time to pass or background work to progress.',
      '- Do NOT tell the user to use a sleep slash command; schedule the deferred resume yourself when appropriate.',
      '- When scheduling, include a concise future prompt describing exactly what to continue or check next.',
    ];

    return {
      systemPrompt: `${event.systemPrompt}\n\n${lines.join('\n')}`,
    };
  });
}
