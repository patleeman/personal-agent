import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from '@sinclair/typebox';

const ASK_USER_QUESTION_LEGACY_MAX_OPTIONS = 6;
const ASK_USER_QUESTION_MAX_QUESTIONS = 8;
const ASK_USER_QUESTION_MAX_OPTIONS_PER_QUESTION = 12;

const AskUserQuestionOptionParams = Type.Object({
  value: Type.String({ minLength: 1, description: 'Stable value sent back when this option is selected.' }),
  label: Type.Optional(Type.String({ description: 'User-facing option label. Defaults to value.' })),
  details: Type.Optional(Type.String({ description: 'Optional supporting text shown under the option.' })),
});

const AskUserQuestionPromptParams = Type.Object({
  id: Type.Optional(Type.String({ description: 'Optional stable question id used to track the answer locally.' })),
  label: Type.Optional(Type.String({ description: 'User-facing question label.' })),
  question: Type.Optional(Type.String({ description: 'Alias for label.' })),
  details: Type.Optional(Type.String({ description: 'Optional supporting context for this question.' })),
  style: Type.Optional(
    Type.Union([Type.Literal('radio'), Type.Literal('check'), Type.Literal('checkbox')], {
      description: 'radio for one choice, check/checkbox for multi-select.',
    }),
  ),
  options: Type.Array(Type.Union([Type.String({ minLength: 1 }), AskUserQuestionOptionParams]), {
    minItems: 1,
    maxItems: ASK_USER_QUESTION_MAX_OPTIONS_PER_QUESTION,
    description: 'Available answers for this question.',
  }),
});

const AskUserQuestionToolParams = Type.Object({
  question: Type.Optional(
    Type.String({
      description: 'Legacy single-question form. Use questions[] for multiple questions or check-style questions.',
    }),
  ),
  details: Type.Optional(
    Type.String({
      description: 'Optional overall context, or legacy single-question context when question is used alone.',
    }),
  ),
  options: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      description: 'Legacy quick-reply options for a single-question prompt.',
      maxItems: ASK_USER_QUESTION_LEGACY_MAX_OPTIONS,
    }),
  ),
  questions: Type.Optional(
    Type.Array(AskUserQuestionPromptParams, {
      minItems: 1,
      maxItems: ASK_USER_QUESTION_MAX_QUESTIONS,
      description: 'Structured questions to render in the desktop UI. Prefer this for multiple questions and radio/check layouts.',
    }),
  ),
});

type AskUserQuestionStyle = 'radio' | 'check';

interface AskUserQuestionOption {
  value: string;
  label: string;
  details?: string;
}

interface AskUserQuestionPrompt {
  id: string;
  label: string;
  details?: string;
  style: AskUserQuestionStyle;
  options: AskUserQuestionOption[];
}

interface AskUserQuestionPayload {
  details?: string;
  questions: AskUserQuestionPrompt[];
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function sanitizeQuestionId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return normalized.length > 0 ? normalized : 'question';
}

function normalizeQuestionStyle(value: unknown): AskUserQuestionStyle {
  if (value === 'check' || value === 'checkbox') {
    return 'check';
  }

  return 'radio';
}

function normalizeOption(value: unknown): AskUserQuestionOption | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? { value: normalized, label: normalized } : null;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as { value?: unknown; label?: unknown; details?: unknown };
  const normalizedValue = readOptionalString(candidate.value) ?? readOptionalString(candidate.label);
  if (!normalizedValue) {
    return null;
  }

  const label = readOptionalString(candidate.label) ?? normalizedValue;
  const details = readOptionalString(candidate.details);

  return {
    value: normalizedValue,
    label,
    ...(details ? { details } : {}),
  };
}

function normalizeOptions(value: unknown): AskUserQuestionOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const options: AskUserQuestionOption[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    const option = normalizeOption(candidate);
    if (!option || seen.has(option.value)) {
      continue;
    }

    seen.add(option.value);
    options.push(option);
  }

  return options;
}

function dedupeQuestionIds(questions: AskUserQuestionPrompt[]): AskUserQuestionPrompt[] {
  const counts = new Map<string, number>();

  return questions.map((question) => {
    const baseId = sanitizeQuestionId(question.id);
    const seenCount = counts.get(baseId) ?? 0;
    counts.set(baseId, seenCount + 1);

    return seenCount === 0 ? question : { ...question, id: `${baseId}-${seenCount + 1}` };
  });
}

function normalizeStructuredPrompt(value: unknown, index: number): AskUserQuestionPrompt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`questions[${index}] must be an object.`);
  }

  const candidate = value as {
    id?: unknown;
    label?: unknown;
    question?: unknown;
    details?: unknown;
    style?: unknown;
    type?: unknown;
    options?: unknown;
  };
  const label = readOptionalString(candidate.label) ?? readOptionalString(candidate.question);
  if (!label) {
    throw new Error(`questions[${index}] requires label or question.`);
  }

  const options = normalizeOptions(candidate.options);
  if (options.length === 0) {
    throw new Error(`questions[${index}] requires at least one option.`);
  }

  const id = sanitizeQuestionId(readOptionalString(candidate.id) ?? `question-${index + 1}`);
  const details = readOptionalString(candidate.details);

  return {
    id,
    label,
    ...(details ? { details } : {}),
    style: normalizeQuestionStyle(candidate.style ?? candidate.type),
    options,
  };
}

function normalizeLegacyQuestion(params: { question?: unknown; details?: unknown; options?: unknown }): AskUserQuestionPayload {
  const question = readOptionalString(params.question);
  if (!question) {
    throw new Error('question is required when questions is not provided.');
  }

  const details = readOptionalString(params.details);
  const options = normalizeOptions(params.options);

  return {
    questions: [
      {
        id: 'question-1',
        label: question,
        ...(details ? { details } : {}),
        style: 'radio',
        options,
      },
    ],
  };
}

function normalizePayload(params: {
  question?: unknown;
  details?: unknown;
  options?: unknown;
  questions?: unknown;
}): AskUserQuestionPayload {
  if (Array.isArray(params.questions) && params.questions.length > 0) {
    const questions = dedupeQuestionIds(params.questions.map((question, index) => normalizeStructuredPrompt(question, index)));
    const details = readOptionalString(params.details);
    return {
      ...(details ? { details } : {}),
      questions,
    };
  }

  return normalizeLegacyQuestion(params);
}

function formatResultText(payload: AskUserQuestionPayload): string {
  const lines = [`Asked the user ${payload.questions.length === 1 ? 'a question' : `${payload.questions.length} questions`}.`];

  if (payload.details) {
    lines.push(`Details: ${payload.details}`);
  }

  for (const [index, question] of payload.questions.entries()) {
    lines.push(`${index + 1}. [${question.style}] ${question.label}`);
    if (question.details) {
      lines.push(`   ${question.details}`);
    }
    if (question.options.length > 0) {
      for (const option of question.options) {
        lines.push(`   - ${option.label}`);
      }
    }
  }

  return lines.join('\n');
}

export function createAskUserQuestionAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'ask_user_question',
      label: 'Ask User Question',
      description: 'Ask one or more focused questions in the desktop UI and wait for the user to answer or skip with a normal prompt.',
      promptSnippet: 'Ask one or more focused questions in the desktop UI.',
      promptGuidelines: [
        'Ask only when blocked on a user answer/approval; use questions[] with radio/check style for structured choices, and use queue_followup for time-based follow-up.',
      ],
      parameters: AskUserQuestionToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const payload = normalizePayload(params);
        const conversationId = ctx.sessionManager.getSessionId();

        return {
          content: [
            {
              type: 'text' as const,
              text: formatResultText(payload),
            },
          ],
          details: {
            action: 'ask_user_question',
            conversationId,
            ...(payload.details ? { details: payload.details } : {}),
            questions: payload.questions,
          },
          terminate: true,
        };
      },
    });
  };
}
