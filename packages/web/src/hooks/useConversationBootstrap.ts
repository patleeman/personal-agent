import { useEffect, useState } from 'react';
import { api } from '../api';
import {
  readPersistedConversationBootstrapEntry,
  writePersistedConversationBootstrapEntry,
} from '../conversationBootstrapPersistence';
import { useAppEvents } from '../contexts';
import type { ConversationBootstrapState } from '../types';

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
  if (!('sessionDetailUnchanged' in normalized)) {
    return normalized;
  }

  const { sessionDetailUnchanged: _sessionDetailUnchanged, ...rest } = normalized;
  return rest;
}

export function mergeConversationBootstrapWithCachedSessionDetail(
  cached: ConversationBootstrapState | null,
  nextData: ConversationBootstrapState,
): ConversationBootstrapState {
  const normalized = normalizeConversationBootstrapState(nextData);
  if (!normalized.sessionDetailUnchanged) {
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
  if (nextSignature && cachedSignature && nextSignature !== cachedSignature) {
    return normalized;
  }

  const { sessionDetailUnchanged: _sessionDetailUnchanged, ...rest } = normalized;
  return {
    ...rest,
    sessionDetail: cachedDetail,
    sessionDetailSignature: cachedSignature ?? nextSignature,
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
    const data = await api.conversationBootstrap(conversationId, {
      ...options,
      ...(knownSessionSignature ? { knownSessionSignature } : {}),
    });
    const nextData = mergeConversationBootstrapWithCachedSessionDetail(cached?.data ?? null, data);
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

export function useConversationBootstrap(
  conversationId: string | undefined,
  options?: { tailBlocks?: number; versionKey?: string },
) {
  const { versions } = useAppEvents();
  const versionKey = options?.versionKey ?? buildConversationBootstrapVersionKey({
    sessionsVersion: versions.sessions,
    sessionFilesVersion: versions.sessionFiles,
  });
  const [data, setData] = useState<ConversationBootstrapState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const memoryCached = readCachedConversationBootstrapEntry(conversationId, options);

    setData(memoryCached?.data ?? null);
    setLoading(!memoryCached);
    setError(null);

    void (async () => {
      let cached = memoryCached;
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
