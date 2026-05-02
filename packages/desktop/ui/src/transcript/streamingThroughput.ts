import type { MessageBlock } from '../shared/types';

const MIN_VISIBLE_ELAPSED_MS = 500;
const MIN_RATE_WINDOW_MS = 1_000;

type StreamingTextBlock = Pick<MessageBlock, 'type' | 'ts'> & { text?: string };

interface StreamingThroughputSample {
  kind: 'text' | 'thinking';
  estimatedTokens: number;
  elapsedMs: number;
  tokensPerSecond: number;
}

function estimateStreamedTextTokens(text: string): number {
  if (!text) {
    return 0;
  }

  return Math.ceil(text.length / 4);
}

function findStreamingTailBlock(blocks: ReadonlyArray<StreamingTextBlock>): StreamingTextBlock | null {
  const tail = blocks[blocks.length - 1];
  if (!tail || (tail.type !== 'text' && tail.type !== 'thinking')) {
    return null;
  }

  return tail;
}

function parseIsoTimestamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return Number.NaN;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : Number.NaN;
}

function readStreamingThroughput(
  blocks: ReadonlyArray<StreamingTextBlock>,
  isStreaming: boolean,
  nowMs = Date.now(),
): StreamingThroughputSample | null {
  if (!isStreaming || !Number.isSafeInteger(nowMs)) {
    return null;
  }

  const tail = findStreamingTailBlock(blocks);
  if (!tail || typeof tail.text !== 'string') {
    return null;
  }

  const estimatedTokens = estimateStreamedTextTokens(tail.text);
  if (estimatedTokens <= 0) {
    return null;
  }

  const startedAtMs = parseIsoTimestamp(tail.ts);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }

  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  if (elapsedMs < MIN_VISIBLE_ELAPSED_MS) {
    return null;
  }

  const rateWindowSeconds = Math.max(elapsedMs / 1000, MIN_RATE_WINDOW_MS / 1000);
  const tokensPerSecond = estimatedTokens / rateWindowSeconds;
  if (!Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) {
    return null;
  }

  return {
    kind: tail.type,
    estimatedTokens,
    elapsedMs,
    tokensPerSecond,
  };
}

function formatStreamingThroughputLabel(sample: StreamingThroughputSample | null): string | null {
  if (!sample) {
    return null;
  }

  const formatted = sample.tokensPerSecond >= 10
    ? sample.tokensPerSecond.toFixed(0)
    : sample.tokensPerSecond.toFixed(1);
  return `~${formatted} tok/s`;
}

export function getStreamingThroughputLabel(
  blocks: ReadonlyArray<StreamingTextBlock>,
  isStreaming: boolean,
  nowMs = Date.now(),
): string | null {
  return formatStreamingThroughputLabel(readStreamingThroughput(blocks, isStreaming, nowMs));
}
