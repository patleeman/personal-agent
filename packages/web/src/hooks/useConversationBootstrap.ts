import { useEffect, useLayoutEffect, useState } from 'react';
import { api } from '../client/api';
import {
  readPersistedConversationBootstrapEntry,
  writePersistedConversationBootstrapEntry,
} from '../conversation/conversationBootstrapPersistence';
import { useAppEvents } from '../app/contexts';
import type { ConversationBootstrapState, SessionDetail } from '../shared/types';

interface CachedConversationBootstrapEntry {
  data: ConversationBootstrapState;
  versionKey: string;
}

function readConversationBootstrapSessionSignature(
  data: ConversationBootstrapState | null | undefined,
): string | undefined {
  const sessionDetailSignature = data?.sessionDetail?.signature?.trim();
  if (sessionDetailSignature) {
    return sessionDetailSignature;
  }

  const bootstrapSignature = data?.sessionDetailSignature?.trim();
  return bootstrapSignature || undefined;
}

function readConversationBootstrapLastBlockId(
  data: ConversationBootstrapState | null | undefined,
): string | undefined {
  const blockId = data?.sessionDetail?.blocks.at(-1)?.id?.trim();
  return blockId && blockId.length > 0 ? blockId : undefined;
}

function mergeAppendOnlyConversationSessionDetail(
  cached: SessionDetail,
  nextData: ConversationBootstrapState,
): SessionDetail | null {
  const appendOnly = nextData.sessionDetailAppendOnly;
  if (!appendOnly) {
    return nextData.sessionDetail;
  }

  const dropCount = Math.max(0, appendOnly.blockOffset - cached.blockOffset);
  const retainedBlocks = cached.blocks.slice(dropCount);
  const nextVisibleLength = Math.max(0, appendOnly.totalBlocks - appendOnly.blockOffset);
  const retainedCount = Math.max(0, nextVisibleLength - appendOnly.blocks.length);
  if (retainedCount > retainedBlocks.length) {
    return null;
  }

  return {
    meta: appendOnly.meta,
    blocks: [...retainedBlocks.slice(retainedBlocks.length - retainedCount), ...appendOnly.blocks],
    blockOffset: appendOnly.blockOffset,
    totalBlocks: appendOnly.totalBlocks,
    contextUsage: appendOnly.contextUsage,
    signature: appendOnly.signature ?? cached.signature,
  };
}

function normalizeConversationBootstrapState(data: ConversationBootstrapState): ConversationBootstrapState {
  const sessionDetailSignature = readConversationBootstrapSessionSignature(data) ?? null;
  if (!data.sessionDetail) {
    return data.sessionDetailSignature === sessionDetailSignature
      ? data
      : {
          ...data,
          sessionDetailSignature,
        };
  }

  const normalizedSessionDetail = sessionDetailSignature && data.sessionDetail.signature !== sessionDetailSignature
    ? {
        ...data.sessionDetail,
        signature: sessionDetailSignature,
      }
    : data.sessionDetail;

  if (normalizedSessionDetail === data.sessionDetail && data.sessionDetailSignature === sessionDetailSignature) {
    return data;
  }

  return {
    ...data,
    sessionDetail: normalizedSessionDetail,
    sessionDetailSignature,
  };
}

function stripConversationBootstrapTransientFlags(
  data: ConversationBootstrapState,
): ConversationBootstrapState {
  const normalized = normalizeConversationBootstrapState(data);
  const rest = { ...normalized };
  delete rest.sessionDetailUnchanged;
  delete rest.sessionDetailAppendOnly;
  return rest;
}

export function mergeConversationBootstrapWithCachedSessionDetail(
  cached: ConversationBootstrapState | null,
  nextData: ConversationBootstrapState,
): ConversationBootstrapState {
  const normalized = normalizeConversationBootstrapState(nextData);
  if (!normalized.sessionDetailUnchanged && !normalized.sessionDetailAppendOnly) {
    return normalized;
  }

  const cachedDetail = cached?.conversationId === normalized.conversationId
    ? cached.sessionDetail
    : null;
  if (!cachedDetail) {
    return normalized;
  }

  const nextSignature = readConversationBootstrapSessionSignature(normalized) ?? null;
  const cachedSignature = cachedDetail.signature?.trim() || readConversationBootstrapSessionSignature(cached) || null;
  if (nextSignature && cachedSignature && nextSignature !== cachedSignature && !normalized.sessionDetailAppendOnly) {
    return normalized;
  }

  const mergedDetail = normalized.sessionDetailAppendOnly
    ? mergeAppendOnlyConversationSessionDetail(cachedDetail, normalized)
    : cachedDetail;
  if (!mergedDetail) {
    return normalized;
  }

  const rest = { ...normalized };
  delete rest.sessionDetailUnchanged;
  delete rest.sessionDetailAppendOnly;
  return {
    ...rest,
    sessionDetail: mergedDetail,
    sessionDetailSignature: readConversationBootstrapSessionSignature({ ...rest, sessionDetail: mergedDetail }) ?? cachedSignature ?? nextSignature,
  };
}

const conversationBootstrapCache = new Map<string, CachedConversationBootstrapEntry>();
const conversationBootstrapInflight = new Map<string, Promise<ConversationBootstrapState>>();
const MAX_CACHED_CONVERSATION_BOOTSTRAPS = 24;

function buildConversationBootstrapCacheKey(conversationId: string, options?: { tailBlocks?: number }): string {
  return `${conversationId}::${options?.tailBlocks ?? 'all'}`;
}

function readCachedConversationBootstrapEntry(
  conversationId: string,
  options?: { tailBlocks?: number },
): CachedConversationBootstrapEntry | null {
  const cacheKey = buildConversationBootstrapCacheKey(conversationId, options);
  const cached = conversationBootstrapCache.get(cacheKey) ?? null;
  if (!cached) {
    return null;
  }

  const normalized = normalizeConversationBootstrapState(cached.data);
  const normalizedEntry = normalized === cached.data
    ? cached
    : {
        ...cached,
        data: normalized,
      };
  conversationBootstrapCache.delete(cacheKey);
  conversationBootstrapCache.set(cacheKey, normalizedEntry);
  return normalizedEntry;
}

function trimConversationBootstrapCache(): void {
  while (conversationBootstrapCache.size > MAX_CACHED_CONVERSATION_BOOTSTRAPS) {
    const oldestKey = conversationBootstrapCache.keys().next().value;
    if (!oldestKey) {
      break;
    }

    conversationBootstrapCache.delete(oldestKey);
  }
}

function writeConversationBootstrapCacheEntry(
  conversationId: string,
  data: ConversationBootstrapState,
  options?: { tailBlocks?: number },
  versionKey = '0',
): CachedConversationBootstrapEntry {
  const cacheKey = buildConversationBootstrapCacheKey(conversationId, options);
  const entry = {
    data: stripConversationBootstrapTransientFlags(data),
    versionKey,
  } satisfies CachedConversationBootstrapEntry;
  conversationBootstrapCache.set(cacheKey, entry);
  trimConversationBootstrapCache();
  void writePersistedConversationBootstrapEntry(conversationId, entry.data, options, versionKey);
  return entry;
}

async function readConversationBootstrapEntry(
  conversationId: string,
  options?: { tailBlocks?: number },
): Promise<CachedConversationBootstrapEntry | null> {
  const cached = readCachedConversationBootstrapEntry(conversationId, options);
  if (cached) {
    return cached;
  }

  const persisted = await readPersistedConversationBootstrapEntry(conversationId, options);
  if (!persisted) {
    return null;
  }

  return writeConversationBootstrapCacheEntry(
    conversationId,
    persisted.data,
    options,
    persisted.versionKey,
  );
}

export function primeConversationBootstrapCache(
  conversationId: string,
  data: ConversationBootstrapState,
  options?: { tailBlocks?: number },
  versionKey = '0',
): void {
  writeConversationBootstrapCacheEntry(conversationId, data, options, versionKey);
}

export function fetchConversationBootstrapCached(
  conversationId: string,
  options?: { tailBlocks?: number },
  versionKey = '0',
): Promise<ConversationBootstrapState> {
  const cacheKey = buildConversationBootstrapCacheKey(conversationId, options);
  const inflightKey = `${cacheKey}::v${versionKey}`;
  const inflight = conversationBootstrapInflight.get(inflightKey);
  if (inflight) {
    return inflight;
  }

  const request = (async () => {
    const cached = await readConversationBootstrapEntry(conversationId, options);
    if (cached && cached.versionKey === versionKey) {
      return cached.data;
    }

    const knownSessionSignature = readConversationBootstrapSessionSignature(cached?.data);
    const cachedSessionDetail = cached?.data.sessionDetail;
    const data = await api.conversationBootstrap(conversationId, {
      ...options,
      ...(knownSessionSignature ? { knownSessionSignature } : {}),
      ...(typeof cachedSessionDetail?.blockOffset === 'number' ? { knownBlockOffset: cachedSessionDetail.blockOffset } : {}),
      ...(typeof cachedSessionDetail?.totalBlocks === 'number' ? { knownTotalBlocks: cachedSessionDetail.totalBlocks } : {}),
      ...(readConversationBootstrapLastBlockId(cached?.data) ? { knownLastBlockId: readConversationBootstrapLastBlockId(cached?.data) } : {}),
    });
    let nextData = mergeConversationBootstrapWithCachedSessionDetail(cached?.data ?? null, data);
    if ((nextData.sessionDetailUnchanged || nextData.sessionDetailAppendOnly) && !nextData.sessionDetail && !nextData.liveSession.live) {
      const fallback = await api.conversationBootstrap(conversationId, options);
      nextData = mergeConversationBootstrapWithCachedSessionDetail(cached?.data ?? null, fallback);
    }
    return writeConversationBootstrapCacheEntry(conversationId, nextData, options, versionKey).data;
  })().finally(() => {
    conversationBootstrapInflight.delete(inflightKey);
  });

  conversationBootstrapInflight.set(inflightKey, request);
  return request;
}

export function buildConversationBootstrapVersionKey(input: {
  sessionsVersion: number;
  sessionFilesVersion: number;
}): string {
  // Bootstrap is only the conversation-open fast path. The page and rail keep the
  // rest of their state incremental with separate invalidations. Session-file bumps
  // still rotate the bootstrap version key, but the server can now reuse a cached
  // transcript window when the conversation file itself did not actually change.
  return `${input.sessionsVersion}:${input.sessionFilesVersion}`;
}

export function resolveConversationBootstrapSeed(
  conversationId: string | undefined,
  options?: { tailBlocks?: number },
): {
  data: ConversationBootstrapState | null;
  loading: boolean;
} {
  if (!conversationId) {
    return {
      data: null,
      loading: false,
    };
  }

  const cached = readCachedConversationBootstrapEntry(conversationId, options);
  return {
    data: cached?.data ?? null,
    loading: !cached,
  };
}

const useCacheSeedEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useConversationBootstrap(
  conversationId: string | undefined,
  options?: { tailBlocks?: number; versionKey?: string },
) {
  const { versions } = useAppEvents();
  const versionKey = options?.versionKey ?? buildConversationBootstrapVersionKey({
    sessionsVersion: versions.sessions,
    sessionFilesVersion: versions.sessionFiles,
  });
  const initialSeed = resolveConversationBootstrapSeed(conversationId, options);
  const [data, setData] = useState<ConversationBootstrapState | null>(initialSeed.data);
  const [loading, setLoading] = useState(initialSeed.loading);
  const [error, setError] = useState<string | null>(null);

  useCacheSeedEffect(() => {
    const seed = resolveConversationBootstrapSeed(conversationId, options);
    setData(seed.data);
    setLoading(seed.loading);
    setError(null);
  }, [conversationId, options?.tailBlocks]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      let cached = readCachedConversationBootstrapEntry(conversationId, options);
      if (!cached) {
        cached = await readConversationBootstrapEntry(conversationId, options);
        if (cancelled) {
          return;
        }

        if (cached) {
          setData(cached.data);
          setLoading(false);
        }
      }

      if (cached?.versionKey === versionKey) {
        return;
      }

      try {
        const nextData = await fetchConversationBootstrapCached(conversationId, options, versionKey);
        if (cancelled) {
          return;
        }

        setData(nextData);
        setLoading(false);
      } catch (nextError) {
        if (cancelled) {
          return;
        }

        setError(nextError instanceof Error ? nextError.message : String(nextError));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, options?.tailBlocks, versionKey]);

  return { data, loading, error };
}
