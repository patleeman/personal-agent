interface PerfApiSample {
  path: string;
  recordedAt: string;
  serverTiming: string | null;
  meta: Record<string, unknown> | null;
}

interface ConversationOpenPhaseSample {
  conversationId: string;
  source: string;
  phase: 'content' | 'rail';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  meta?: Record<string, unknown>;
}

interface ConversationOpenTracker {
  startedAtMs: number;
  startedAt: string;
  source: string;
  completedPhases: Set<'content' | 'rail'>;
}

interface PerfStore {
  apiSamples: PerfApiSample[];
  conversationOpenSamples: ConversationOpenPhaseSample[];
}

const MAX_PERF_SAMPLES = 120;
const perfStore: PerfStore = {
  apiSamples: [],
  conversationOpenSamples: [],
};
const conversationOpenTrackers = new Map<string, ConversationOpenTracker>();
publishPerfStore();

function appendSample<T>(samples: T[], sample: T): void {
  samples.push(sample);
  while (samples.length > MAX_PERF_SAMPLES) {
    samples.shift();
  }
}

function getGlobalPerfTarget(): { __PA_APP_PERF__?: PerfStore } {
  return globalThis as { __PA_APP_PERF__?: PerfStore };
}

function publishPerfStore(): void {
  getGlobalPerfTarget().__PA_APP_PERF__ = perfStore;
}

function shouldLogPerfSamples(): boolean {
  try {
    return globalThis.localStorage?.getItem('pa.debugPerf') === '1';
  } catch {
    return false;
  }
}

function safeParsePerfMeta(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function recordApiTiming(path: string, res: Response): void {
  const serverTiming = res.headers.get('Server-Timing');
  const meta = safeParsePerfMeta(res.headers.get('X-PA-Perf'));
  if (!serverTiming && !meta) {
    return;
  }

  const sample: PerfApiSample = {
    path,
    recordedAt: new Date().toISOString(),
    serverTiming,
    meta,
  };
  appendSample(perfStore.apiSamples, sample);
  publishPerfStore();
  if (shouldLogPerfSamples()) {
    console.info('[pa-perf][api]', sample);
  }
}

function markConversationOpenStart(conversationId: string, source = 'route'): void {
  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) {
    return;
  }

  conversationOpenTrackers.set(normalizedConversationId, {
    startedAtMs: performance.now(),
    startedAt: new Date().toISOString(),
    source,
    completedPhases: new Set(),
  });
}

export function ensureConversationOpenStart(conversationId: string, source = 'route'): void {
  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId || conversationOpenTrackers.has(normalizedConversationId)) {
    return;
  }

  markConversationOpenStart(normalizedConversationId, source);
}

export function completeConversationOpenPhase(
  conversationId: string,
  phase: 'content' | 'rail',
  meta?: Record<string, unknown>,
): void {
  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) {
    return;
  }

  const tracker = conversationOpenTrackers.get(normalizedConversationId);
  if (!tracker || tracker.completedPhases.has(phase)) {
    return;
  }

  tracker.completedPhases.add(phase);
  const durationMs = performance.now() - tracker.startedAtMs;
  const sample: ConversationOpenPhaseSample = {
    conversationId: normalizedConversationId,
    source: tracker.source,
    phase,
    startedAt: tracker.startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    ...(meta ? { meta } : {}),
  };
  appendSample(perfStore.conversationOpenSamples, sample);
  publishPerfStore();
  if (shouldLogPerfSamples()) {
    console.info('[pa-perf][conversation-open]', sample);
  }

  if (tracker.completedPhases.has('content') && tracker.completedPhases.has('rail')) {
    conversationOpenTrackers.delete(normalizedConversationId);
  }
}
