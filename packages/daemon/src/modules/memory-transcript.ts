import { basename, extname } from 'path';
import { readFileSync } from 'fs';
import type {
  ParsedSessionTranscript,
  ResolvedMemoryConfig,
  SessionMemoryCardRequest,
  SessionSummaryRequest,
} from './memory-types.js';

interface TranscriptLine {
  text: string;
  isError: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  if (maxChars <= 3) {
    return value.slice(0, maxChars);
  }

  return `${value.slice(0, maxChars - 3)}...`;
}

function extractTextBlocks(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }

  const parts: string[] = [];

  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }

    if (block.type !== 'text') {
      continue;
    }

    if (typeof block.text !== 'string') {
      continue;
    }

    parts.push(block.text);
  }

  return parts.join('\n');
}

function summarizeToolArguments(argumentsValue: unknown): string {
  if (!isRecord(argumentsValue)) {
    return '';
  }

  const fields: string[] = [];

  const pushField = (label: string, raw: unknown): void => {
    if (typeof raw !== 'string') {
      return;
    }

    const normalized = normalizeWhitespace(raw);
    if (normalized.length === 0) {
      return;
    }

    fields.push(`${label}="${clipText(normalized, 140)}"`);
  };

  pushField('path', argumentsValue.path);
  pushField('command', argumentsValue.command);
  pushField('url', argumentsValue.url);
  pushField('query', argumentsValue.query);
  pushField('name', argumentsValue.name);

  if (fields.length > 0) {
    return fields.join(', ');
  }

  const keys = Object.keys(argumentsValue);
  if (keys.length === 0) {
    return '';
  }

  return `keys=${keys.slice(0, 6).join(',')}`;
}

function extractToolCalls(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const calls: string[] = [];

  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }

    if (block.type !== 'toolCall') {
      continue;
    }

    const toolName = typeof block.name === 'string' ? block.name : 'unknown-tool';
    const argumentSummary = summarizeToolArguments(block.arguments);

    if (argumentSummary.length > 0) {
      calls.push(`TOOL_CALL ${toolName} (${argumentSummary})`);
    } else {
      calls.push(`TOOL_CALL ${toolName}`);
    }
  }

  return calls;
}

function totalTranscriptChars(lines: TranscriptLine[]): number {
  return lines.reduce((total, line) => total + line.text.length, 0) + Math.max(0, lines.length - 1);
}

function findDroppableIndex(lines: TranscriptLine[]): number {
  let index = Math.floor(lines.length / 2);

  while (index < lines.length - 1 && lines[index].isError) {
    index += 1;
  }

  if (index >= lines.length - 1) {
    index = Math.floor(lines.length / 2);
    while (index > 0 && lines[index].isError) {
      index -= 1;
    }
  }

  return Math.min(Math.max(index, 1), lines.length - 2);
}

function constrainTranscript(lines: TranscriptLine[], config: ResolvedMemoryConfig): TranscriptLine[] {
  let constrained = lines.map((line) => ({
    text: clipText(normalizeWhitespace(line.text), config.summarization.maxCharsPerTurn),
    isError: line.isError,
  }));

  if (constrained.length > config.summarization.maxTurns) {
    const headCount = Math.max(1, Math.floor(config.summarization.maxTurns * 0.4));
    const tailCount = Math.max(1, Math.floor(config.summarization.maxTurns * 0.4));
    const middleStart = headCount;
    const middleEnd = Math.max(middleStart, constrained.length - tailCount);
    const middle = constrained.slice(middleStart, middleEnd);
    const middleErrors = middle.filter((line) => line.isError);
    const retainedErrors = middleErrors.slice(-Math.min(4, middleErrors.length));

    const omittedCount = constrained.length - headCount - tailCount - retainedErrors.length;

    constrained = [
      ...constrained.slice(0, headCount),
      ...(omittedCount > 0
        ? [
            {
              text: `... omitted ${omittedCount} transcript lines ...`,
              isError: false,
            },
          ]
        : []),
      ...retainedErrors,
      ...constrained.slice(-tailCount),
    ];

    if (constrained.length > config.summarization.maxTurns) {
      constrained = constrained.slice(0, config.summarization.maxTurns);
    }
  }

  while (
    constrained.length > 3
    && totalTranscriptChars(constrained) > config.summarization.maxTranscriptChars
  ) {
    const dropIndex = findDroppableIndex(constrained);
    constrained.splice(dropIndex, 1);
  }

  if (totalTranscriptChars(constrained) > config.summarization.maxTranscriptChars) {
    const perLineCap = Math.max(80, Math.floor(config.summarization.maxTranscriptChars / Math.max(1, constrained.length)));
    constrained = constrained.map((line) => ({
      ...line,
      text: clipText(line.text, perLineCap),
    }));
  }

  if (totalTranscriptChars(constrained) > config.summarization.maxTranscriptChars) {
    const combined = constrained.map((line) => line.text).join('\n');
    constrained = [{ text: clipText(combined, config.summarization.maxTranscriptChars), isError: false }];
  }

  return constrained;
}

export function parseSessionTranscript(sessionFile: string, config: ResolvedMemoryConfig): ParsedSessionTranscript {
  const raw = readFileSync(sessionFile, 'utf-8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);

  let sessionId = basename(sessionFile, extname(sessionFile));
  let cwd = 'unknown';
  let startedAt = 'unknown';
  let endedAt = 'unknown';

  const transcriptLines: TranscriptLine[] = [];

  for (const line of lines) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isRecord(parsed)) {
      continue;
    }

    if (parsed.type === 'session') {
      if (typeof parsed.id === 'string' && parsed.id.length > 0) {
        sessionId = parsed.id;
      }

      if (typeof parsed.cwd === 'string' && parsed.cwd.length > 0) {
        cwd = parsed.cwd;
      }

      if (typeof parsed.timestamp === 'string' && parsed.timestamp.length > 0) {
        startedAt = parsed.timestamp;
      }

      continue;
    }

    if (parsed.type !== 'message' || !isRecord(parsed.message)) {
      continue;
    }

    const role = typeof parsed.message.role === 'string' ? parsed.message.role : 'unknown';

    if (typeof parsed.timestamp === 'string' && parsed.timestamp.length > 0) {
      endedAt = parsed.timestamp;
    }

    if (role === 'user') {
      const userText = normalizeWhitespace(extractTextBlocks(parsed.message.content));
      if (userText.length > 0) {
        transcriptLines.push({
          text: `USER: ${userText}`,
          isError: false,
        });
      }
      continue;
    }

    if (role === 'assistant') {
      const assistantText = normalizeWhitespace(extractTextBlocks(parsed.message.content));
      if (assistantText.length > 0) {
        transcriptLines.push({
          text: `ASSISTANT: ${assistantText}`,
          isError: false,
        });
      }

      for (const call of extractToolCalls(parsed.message.content)) {
        transcriptLines.push({
          text: call,
          isError: false,
        });
      }

      continue;
    }

    if (role === 'toolResult') {
      const toolName = typeof parsed.message.toolName === 'string' ? parsed.message.toolName : 'unknown-tool';
      const isError = parsed.message.isError === true;

      if (!isError) {
        continue;
      }

      const resultText = normalizeWhitespace(extractTextBlocks(parsed.message.content));
      transcriptLines.push({
        text: `TOOL_ERROR ${toolName}: ${resultText.length > 0 ? resultText : 'unknown error'}`,
        isError: true,
      });
    }
  }

  const constrained = constrainTranscript(transcriptLines, config);
  const transcript = constrained.map((line) => line.text).join('\n');

  return {
    sessionId,
    cwd,
    startedAt,
    endedAt,
    transcript: transcript.length > 0 ? transcript : 'No user or assistant transcript content found.',
  };
}

export function buildSummaryPrompt(request: SessionSummaryRequest): string {
  return [
    'You are writing long-term memory for a concluded personal-agent coding session.',
    'The output should maximize retrieval value for a single-user, single-machine setup.',
    'Memory uses ~90-day retention; favor durable signals that remain useful across related sessions.',
    'Return markdown only.',
    `Start with heading: # Session ${request.sessionId}`,
    'Use the following section headings in this order when they have real signal:',
    '- ## Context',
    '- ## Durable Decisions',
    '- ## Supersedes',
    '- ## Decision Rationale and Tradeoffs',
    '- ## Contracts, Constraints, and Invariants',
    '- ## Pitfalls and Debugging Insights',
    '- ## Additional Notable Insights',
    '- ## Open Loops',
    '- ## Retrieval Tags',
    '',
    'Rules:',
    '- Be factual. Use only transcript evidence.',
    '- Use concise bullet points inside sections.',
    '- Omit empty sections. Do not emit placeholder sections.',
    '- Never write "unknown", "none", or "n/a" as section content.',
    '- Prioritize durable technical insight over activity logs.',
    '- Include key packages/files/functions/subsystems when they materially changed behavior, contracts, or architecture.',
    '- Do not include command dumps, precise timestamps, or broad file inventories.',
    '- ## Context must be 1–3 lines and include objective + affected subsystem(s) in objective terms.',
    '- ## Durable Decisions must be phrased as stable rules/contracts, not activity logs.',
    '- Include ## Supersedes only when transcript evidence shows this session explicitly overrides prior decisions/behavior; include a session id when available, otherwise a short superseded description.',
    '- ## Open Loops must use actionable GitHub-style checkbox bullets: "- [ ] ...".',
    '- Capture rejected alternatives and why they were rejected when present.',
    '- Keep context minimal and stable. Do not report exact durations.',
    '- Use "## Additional Notable Insights" for important observations that do not fit other buckets.',
    '- If the session is low-signal, keep output short: Context + Retrieval Tags (and Open Loops only if real).',
    '- Never include hidden reasoning.',
    '',
    'Session metadata (context only):',
    `- sessionId: ${request.sessionId}`,
    `- cwd: ${request.cwd}`,
    '',
    'Compact transcript:',
    '```text',
    request.transcript,
    '```',
  ].join('\n');
}

export function buildMemoryCardPrompt(request: SessionMemoryCardRequest): string {
  return [
    'You are generating a structured retrieval card for a concluded personal-agent coding session.',
    'Return STRICT JSON only.',
    'No markdown. No explanations. No extra keys.',
    'Card must be factual and based only on transcript evidence.',
    '',
    'Schema (fixed keys):',
    '{',
    '  "type": "memory_card",',
    '  "session_id": "<string>",',
    '  "cwd": "<string>",',
    '  "subsystems": ["<string>"],',
    '  "primary_topics": ["<string>"],',
    '  "durable_decisions": ["<string>"],',
    '  "invariants": ["<string>"],',
    '  "pitfalls": ["<string>"],',
    '  "open_loops": ["<string>"],',
    '  "supersedes": "<string | null>",',
    '  "summary_path": "<string>"',
    '}',
    '',
    'Rules:',
    '- Use only transcript evidence.',
    '- Prefer identifiers (commands, files, packages, functions, APIs, subsystems).',
    '- Keep arrays concise and high-signal.',
    '- durable_decisions: stable final-state rules/contracts, not activity logs.',
    '- open_loops: actionable unfinished tasks phrased as imperative tasks (no checkboxes).',
    '- supersedes: null unless transcript explicitly indicates supersession.',
    '- Do not include timestamps or command dumps.',
    '',
    'Session metadata:',
    `- session_id: ${request.sessionId}`,
    `- cwd: ${request.cwd}`,
    `- summary_path: ${request.summaryRelativePath}`,
    '',
    'Compact transcript:',
    '```text',
    request.transcript,
    '```',
  ].join('\n');
}
