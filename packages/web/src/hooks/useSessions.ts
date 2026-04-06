import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAppEvents } from '../contexts';
import type { SessionDetail, SessionDetailResult } from '../types';

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

export function mergeSessionDetailResultWithCachedDetail(
  cached: SessionDetail | null,
  result: SessionDetailResult,
): SessionDetail | null {
  if (!('unchanged' in result)) {
    return result;
  }

  if (!cached) {
    return null;
  }

  const cachedSignature = readSessionDetailSignature(cached) ?? null;
  if (result.signature && cachedSignature && result.signature !== cachedSignature) {
    return null;
  }

  return cached;
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

export function useSessionDetail(sessionId: string | undefined, options?: { tailBlocks?: number }) {
  const { versions } = useAppEvents();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setDetail(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const cached = readCachedSessionDetailEntry(sessionId, options);
    const hasFreshCache = cached?.version === versions.sessionFiles;

    setDetail(cached?.detail ?? null);
    setLoading(!cached);
    setError(null);

    if (hasFreshCache) {
      return;
    }

    fetchSessionDetailCached(sessionId, options, versions.sessionFiles)
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
  }, [options?.tailBlocks, sessionId, versions.sessionFiles]);

  return { detail, loading, error };
}
