import type { MessageBlock } from './types';

export type AskUserQuestionStyle = 'radio' | 'check';

export interface AskUserQuestionOption {
  value: string;
  label: string;
  details?: string;
}

export interface AskUserQuestionPrompt {
  id: string;
  label: string;
  details?: string;
  style: AskUserQuestionStyle;
  options: AskUserQuestionOption[];
}

export interface AskUserQuestionPresentation {
  details?: string;
  questions: AskUserQuestionPrompt[];
}

export type AskUserQuestionAnswers = Record<string, string[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function normalizeQuestionOption(value: unknown): AskUserQuestionOption | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? { value: normalized, label: normalized } : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const optionValue = readOptionalString(value.value) ?? readOptionalString(value.label);
  if (!optionValue) {
    return null;
  }

  return {
    value: optionValue,
    label: readOptionalString(value.label) ?? optionValue,
    ...(readOptionalString(value.details) ?? readOptionalString(value.description)
      ? { details: readOptionalString(value.details) ?? readOptionalString(value.description) }
      : {}),
  };
}

function normalizeQuestionOptions(value: unknown): AskUserQuestionOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const options: AskUserQuestionOption[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    const option = normalizeQuestionOption(candidate);
    if (!option) {
      continue;
    }

    const dedupeKey = option.value;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
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

    return seenCount === 0
      ? question
      : { ...question, id: `${baseId}-${seenCount + 1}` };
  });
}

function normalizeStructuredQuestion(value: unknown, index: number): AskUserQuestionPrompt | null {
  if (!isRecord(value)) {
    return null;
  }

  const label = readOptionalString(value.label) ?? readOptionalString(value.question);
  if (!label) {
    return null;
  }

  const options = normalizeQuestionOptions(value.options);
  if (options.length === 0) {
    return null;
  }

  const providedId = readOptionalString(value.id);

  return {
    id: sanitizeQuestionId(providedId ?? `question-${index + 1}`),
    label,
    ...(readOptionalString(value.details) ?? readOptionalString(value.description)
      ? { details: readOptionalString(value.details) ?? readOptionalString(value.description) }
      : {}),
    style: normalizeQuestionStyle(value.style ?? value.type),
    options,
  };
}

function normalizeLegacyQuestion(source: Record<string, unknown>): AskUserQuestionPresentation | null {
  const question = readOptionalString(source.question) ?? readOptionalString(source.label);
  if (!question) {
    return null;
  }

  const options = normalizeQuestionOptions(source.options);
  const details = readOptionalString(source.details) ?? readOptionalString(source.description);

  return {
    questions: [{
      id: 'question-1',
      label: question,
      ...(details ? { details } : {}),
      style: 'radio',
      options,
    }],
  };
}

function normalizeStructuredQuestions(source: Record<string, unknown>): AskUserQuestionPresentation | null {
  if (!Array.isArray(source.questions)) {
    return null;
  }

  const questions = dedupeQuestionIds(source.questions
    .map((question, index) => normalizeStructuredQuestion(question, index))
    .filter((question): question is AskUserQuestionPrompt => question !== null));

  if (questions.length === 0) {
    return null;
  }

  const details = readOptionalString(source.details) ?? readOptionalString(source.description);

  return {
    ...(details ? { details } : {}),
    questions,
  };
}

export function readAskUserQuestionPresentation(block: Extract<MessageBlock, { type: 'tool_use' }>): AskUserQuestionPresentation | null {
  if (block.tool !== 'ask_user_question') {
    return null;
  }

  const detailsPresentation = isRecord(block.details)
    ? normalizeStructuredQuestions(block.details) ?? normalizeLegacyQuestion(block.details)
    : null;
  if (detailsPresentation) {
    return detailsPresentation;
  }

  return isRecord(block.input)
    ? normalizeStructuredQuestions(block.input) ?? normalizeLegacyQuestion(block.input)
    : null;
}

export function isAskUserQuestionComplete(
  presentation: AskUserQuestionPresentation,
  answers: AskUserQuestionAnswers,
): boolean {
  return presentation.questions.every((question) => (answers[question.id]?.length ?? 0) > 0);
}

export function resolveAskUserQuestionAnswerLabels(
  question: AskUserQuestionPrompt,
  selectedValues: string[],
): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const value of selectedValues) {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      continue;
    }

    const option = question.options.find((candidate) => candidate.value === normalizedValue || candidate.label === normalizedValue);
    const label = option?.label ?? normalizedValue;
    if (seen.has(label)) {
      continue;
    }

    seen.add(label);
    labels.push(label);
  }

  return labels;
}

export function buildAskUserQuestionReplyText(
  presentation: AskUserQuestionPresentation,
  answers: AskUserQuestionAnswers,
): string {
  const questionAnswers = presentation.questions
    .map((question) => {
      const labels = resolveAskUserQuestionAnswerLabels(question, answers[question.id] ?? []);
      return labels.length > 0 ? { question, labels } : null;
    })
    .filter((entry): entry is { question: AskUserQuestionPrompt; labels: string[] } => entry !== null);

  if (questionAnswers.length === 0) {
    return '';
  }

  if (questionAnswers.length === 1 && questionAnswers[0].question.style === 'radio' && questionAnswers[0].labels.length === 1) {
    return questionAnswers[0].labels[0] ?? '';
  }

  if (questionAnswers.length === 1) {
    return `${questionAnswers[0].question.label}: ${questionAnswers[0].labels.join(', ')}`;
  }

  return [
    'Answers:',
    ...questionAnswers.map(({ question, labels }) => `- ${question.label}: ${labels.join(', ')}`),
  ].join('\n');
}
