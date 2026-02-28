import { basename, extname } from 'path';
import { readFileSync } from 'fs';
import type { ParsedSessionTranscript, ResolvedMemoryConfig, SessionSummaryRequest } from './memory-types.js';

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
    'You are summarizing a concluded personal-agent coding session.',
    'Return markdown only.',
    'Use exactly these headings:',
    `# Session ${request.sessionId}`,
    '## Session Metadata',
    '## Goal',
    '## Key Decisions',
    '## Changes Made',
    '## Files Touched',
    '## Commands and Tools',
    '## Errors and Fixes',
    '## Follow-ups',
    '',
    'Rules:',
    '- Be factual. Use only transcript evidence.',
    '- Use concise bullet points inside sections.',
    '- If information is missing, write "unknown".',
    '- Never include hidden reasoning.',
    '',
    'Session metadata:',
    `- sessionFile: ${request.sessionFile}`,
    `- sessionId: ${request.sessionId}`,
    `- cwd: ${request.cwd}`,
    `- startedAt: ${request.startedAt}`,
    `- endedAt: ${request.endedAt}`,
    '',
    'Compact transcript:',
    '```text',
    request.transcript,
    '```',
  ].join('\n');
}
