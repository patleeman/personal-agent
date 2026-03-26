import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAppEvents } from '../contexts';
import type { ConversationBootstrapState } from '../types';

interface CachedConversationBootstrapEntry {
  data: ConversationBootstrapState;
  versionKey: string;
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
  if (cached) {
    conversationBootstrapCache.delete(cacheKey);
    conversationBootstrapCache.set(cacheKey, cached);
  }
  return cached;
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

export function primeConversationBootstrapCache(
  conversationId: string,
  data: ConversationBootstrapState,
  options?: { tailBlocks?: number },
  versionKey = '0',
): void {
  const cacheKey = buildConversationBootstrapCacheKey(conversationId, options);
  conversationBootstrapCache.set(cacheKey, { data, versionKey });
  trimConversationBootstrapCache();
}

export function fetchConversationBootstrapCached(
  conversationId: string,
  options?: { tailBlocks?: number },
  versionKey = '0',
): Promise<ConversationBootstrapState> {
  const cacheKey = buildConversationBootstrapCacheKey(conversationId, options);
  const cached = readCachedConversationBootstrapEntry(conversationId, options);
  if (cached && cached.versionKey === versionKey) {
    return Promise.resolve(cached.data);
  }

  const inflightKey = `${cacheKey}::v${versionKey}`;
  const inflight = conversationBootstrapInflight.get(inflightKey);
  if (inflight) {
    return inflight;
  }

  const request = api.conversationBootstrap(conversationId, options)
    .then((data) => {
      conversationBootstrapCache.set(cacheKey, { data, versionKey });
      trimConversationBootstrapCache();
      return data;
    })
    .finally(() => {
      conversationBootstrapInflight.delete(inflightKey);
    });

  conversationBootstrapInflight.set(inflightKey, request);
  return request;
}

export function useConversationBootstrap(
  conversationId: string | undefined,
  options?: { tailBlocks?: number; versionKey?: string },
) {
  const { versions } = useAppEvents();
  const versionKey = options?.versionKey ?? `${versions.sessions}:${versions.projects}:${versions.runs}:${versions.executionTargets}`;
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
    const cached = readCachedConversationBootstrapEntry(conversationId, options);
    const hasFreshCache = cached?.versionKey === versionKey;

    setData(cached?.data ?? null);
    setLoading(!cached);
    setError(null);

    if (hasFreshCache) {
      return;
    }

    fetchConversationBootstrapCached(conversationId, options, versionKey)
      .then((nextData) => {
        if (cancelled) {
          return;
        }

        setData(nextData);
        setLoading(false);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }

        setError(nextError instanceof Error ? nextError.message : String(nextError));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, options?.tailBlocks, versionKey]);

  return { data, loading, error };
}
