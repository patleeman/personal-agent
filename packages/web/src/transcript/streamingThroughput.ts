import type { MessageBlock } from '../types';

const MIN_VISIBLE_ELAPSED_MS = 500;
const MIN_RATE_WINDOW_MS = 1_000;

type StreamingTextBlock = Pick<MessageBlock, 'type' | 'ts'> & { text?: string };

export interface StreamingThroughputSample {
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

export function readStreamingThroughput(
  blocks: ReadonlyArray<StreamingTextBlock>,
  isStreaming: boolean,
  nowMs = Date.now(),
): StreamingThroughputSample | null {
  if (!isStreaming || !Number.isFinite(nowMs)) {
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

  const startedAtMs = Date.parse(tail.ts);
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

export function formatStreamingThroughputLabel(sample: StreamingThroughputSample | null): string | null {
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
