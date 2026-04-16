import { useEffect, useLayoutEffect, useState } from 'react';
import { api } from '../client/api';
import { useAppEvents } from '../app/contexts';
import type { SessionDetail, SessionDetailAppendOnlyResponse, SessionDetailResult } from '../shared/types';

interface CachedSessionDetailEntry {
  detail: SessionDetail;
  version: number;
}

const sessionDetailCache = new Map<string, CachedSessionDetailEntry>();
const sessionDetailInflight = new Map<string, Promise<SessionDetail>>();
const MAX_CACHED_SESSION_DETAILS = 24;

function readSessionDetailSignature(detail: SessionDetail | null | undefined): string | undefined {
  const signature = detail?.signature?.trim();
  return signature && signature.length > 0 ? signature : undefined;
}

function readSessionDetailLastBlockId(detail: SessionDetail | null | undefined): string | undefined {
  const blockId = detail?.blocks.at(-1)?.id?.trim();
  return blockId && blockId.length > 0 ? blockId : undefined;
}

function mergeAppendOnlySessionDetail(
  cached: SessionDetail,
  result: SessionDetailAppendOnlyResponse,
): SessionDetail | null {
  const dropCount = Math.max(0, result.blockOffset - cached.blockOffset);
  const retainedBlocks = cached.blocks.slice(dropCount);
  const nextVisibleLength = Math.max(0, result.totalBlocks - result.blockOffset);
  const retainedCount = Math.max(0, nextVisibleLength - result.blocks.length);
  if (retainedCount > retainedBlocks.length) {
    return null;
  }

  return {
    meta: result.meta,
    blocks: [...retainedBlocks.slice(retainedBlocks.length - retainedCount), ...result.blocks],
    blockOffset: result.blockOffset,
    totalBlocks: result.totalBlocks,
    contextUsage: result.contextUsage,
    signature: result.signature ?? cached.signature,
  };
}

function mergeSessionDetailResultWithCachedDetail(
  cached: SessionDetail | null,
  result: SessionDetailResult,
): SessionDetail | null {
  if ('unchanged' in result) {
    if (!cached) {
      return null;
    }

    const cachedSignature = readSessionDetailSignature(cached) ?? null;
    if (result.signature && cachedSignature && result.signature !== cachedSignature) {
      return null;
    }

    return cached;
  }

  if ('appendOnly' in result) {
    if (!cached) {
      return null;
    }

    return mergeAppendOnlySessionDetail(cached, result);
  }

  return result;
}

function buildSessionDetailCacheKey(sessionId: string, options?: { tailBlocks?: number }): string {
  return `${sessionId}::${options?.tailBlocks ?? 'all'}`;
}

function readCachedSessionDetailEntry(sessionId: string, options?: { tailBlocks?: number }): CachedSessionDetailEntry | null {
  const cacheKey = buildSessionDetailCacheKey(sessionId, options);
  const cached = sessionDetailCache.get(cacheKey) ?? null;
  if (cached) {
    sessionDetailCache.delete(cacheKey);
    sessionDetailCache.set(cacheKey, cached);
  }
  return cached;
}

function trimSessionDetailCache(): void {
  while (sessionDetailCache.size > MAX_CACHED_SESSION_DETAILS) {
    const oldestKey = sessionDetailCache.keys().next().value;
    if (!oldestKey) {
      break;
    }

    sessionDetailCache.delete(oldestKey);
  }
}

export function primeSessionDetailCache(
  sessionId: string,
  detail: SessionDetail,
  options?: { tailBlocks?: number },
  version = 0,
): void {
  const cacheKey = buildSessionDetailCacheKey(sessionId, options);
  sessionDetailCache.set(cacheKey, { detail, version });
  trimSessionDetailCache();
}

export function fetchSessionDetailCached(
  sessionId: string,
  options?: { tailBlocks?: number },
  version = 0,
): Promise<SessionDetail> {
  const cacheKey = buildSessionDetailCacheKey(sessionId, options);
  const cached = readCachedSessionDetailEntry(sessionId, options);
  if (cached && cached.version === version) {
    return Promise.resolve(cached.detail);
  }

  const inflightKey = `${cacheKey}::v${version}`;
  const inflight = sessionDetailInflight.get(inflightKey);
  if (inflight) {
    return inflight;
  }

  const request = api.sessionDetail(sessionId, {
    ...options,
    ...(readSessionDetailSignature(cached?.detail) ? { knownSessionSignature: readSessionDetailSignature(cached?.detail) } : {}),
    ...(typeof cached?.detail?.blockOffset === 'number' ? { knownBlockOffset: cached.detail.blockOffset } : {}),
    ...(typeof cached?.detail?.totalBlocks === 'number' ? { knownTotalBlocks: cached.detail.totalBlocks } : {}),
    ...(readSessionDetailLastBlockId(cached?.detail) ? { knownLastBlockId: readSessionDetailLastBlockId(cached?.detail) } : {}),
  })
    .then(async (result) => {
      let detail = mergeSessionDetailResultWithCachedDetail(cached?.detail ?? null, result);
      if (!detail) {
        const fallback = await api.sessionDetail(sessionId, options);
        detail = mergeSessionDetailResultWithCachedDetail(null, fallback);
      }
      if (!detail) {
        throw new Error('Session detail cache reuse failed without a fresh transcript payload.');
      }

      sessionDetailCache.set(cacheKey, { detail, version });
      trimSessionDetailCache();
      return detail;
    })
    .finally(() => {
      sessionDetailInflight.delete(inflightKey);
    });

  sessionDetailInflight.set(inflightKey, request);
  return request;
}

function resolveSessionDetailSeed(
  sessionId: string | undefined,
  options?: { tailBlocks?: number },
): {
  detail: SessionDetail | null;
  loading: boolean;
} {
  if (!sessionId) {
    return {
      detail: null,
      loading: false,
    };
  }

  const cached = readCachedSessionDetailEntry(sessionId, options);
  return {
    detail: cached?.detail ?? null,
    loading: !cached,
  };
}

const useCacheSeedEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useSessionDetail(sessionId: string | undefined, options?: { tailBlocks?: number; version?: number }) {
  const { versions } = useAppEvents();
  const detailVersion = options?.version ?? versions.sessionFiles;
  const cacheOptions = options ? { tailBlocks: options.tailBlocks } : undefined;
  const initialSeed = resolveSessionDetailSeed(sessionId, cacheOptions);
  const [detail, setDetail] = useState<SessionDetail | null>(initialSeed.detail);
  const [loading, setLoading] = useState(initialSeed.loading);
  const [error, setError] = useState<string | null>(null);

  useCacheSeedEffect(() => {
    const seed = resolveSessionDetailSeed(sessionId, cacheOptions);
    setDetail(seed.detail);
    setLoading(seed.loading);
    setError(null);
  }, [cacheOptions?.tailBlocks, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    let cancelled = false;
    const cached = readCachedSessionDetailEntry(sessionId, cacheOptions);
    const hasFreshCache = cached?.version === detailVersion;

    if (hasFreshCache) {
      return;
    }

    fetchSessionDetailCached(sessionId, cacheOptions, detailVersion)
      .then((data) => {
        if (cancelled) {
          return;
        }

        setDetail(data);
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
  }, [cacheOptions?.tailBlocks, detailVersion, sessionId]);

  return { detail, loading, error };
}
