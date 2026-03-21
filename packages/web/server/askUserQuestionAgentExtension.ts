import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

const ASK_USER_QUESTION_MAX_OPTIONS = 6;

const AskUserQuestionToolParams = Type.Object({
  question: Type.String({
    description: 'The focused question you need the user to answer before you can continue.',
  }),
  details: Type.Optional(Type.String({
    description: 'Optional short context that helps the user answer the question.',
  })),
  options: Type.Optional(Type.Array(
    Type.String({ minLength: 1 }),
    {
      description: 'Optional quick-reply options to render in the web UI.',
      maxItems: ASK_USER_QUESTION_MAX_OPTIONS,
    },
  )),
});

function readRequiredQuestion(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error('question is required.');
  }

  return normalized;
}

function readOptionalDetails(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeOptions(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique: string[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    const normalized = candidate.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(normalized);
    if (unique.length >= ASK_USER_QUESTION_MAX_OPTIONS) {
      break;
    }
  }

  return unique;
}

function formatResultText(question: string, details?: string, options: string[] = []): string {
  const lines = [`Asked the user: ${question}`];

  if (details) {
    lines.push(`Details: ${details}`);
  }

  if (options.length > 0) {
    lines.push(`Options: ${options.join(' | ')}`);
  }

  return lines.join('\n');
}

export function createAskUserQuestionAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'ask_user_question',
      label: 'Ask User Question',
      description: 'Ask the user a focused question in the web UI and wait for their reply before continuing.',
      promptSnippet: 'Ask the user a focused question in the web UI.',
      promptGuidelines: [
        'Use this tool when you need a specific answer, choice, or approval from the user before you can continue.',
        'Ask one focused question at a time.',
        'Use options only for short, natural quick replies the user can tap.',
        'After calling this tool, wait for the user response instead of continuing as if the answer is already known.',
      ],
      parameters: AskUserQuestionToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const question = readRequiredQuestion(params.question);
        const details = readOptionalDetails(params.details);
        const options = normalizeOptions(params.options);
        const conversationId = ctx.sessionManager.getSessionId();

        return {
          content: [{
            type: 'text' as const,
            text: formatResultText(question, details, options),
          }],
          details: {
            action: 'ask_user_question',
            conversationId,
            question,
            ...(details ? { details } : {}),
            ...(options.length > 0 ? { options } : {}),
          },
        };
      },
    });
  };
}
