import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAppEvents } from '../contexts';
import type { SessionDetail } from '../types';

interface CachedSessionDetailEntry {
  detail: SessionDetail;
  version: number;
}

const sessionDetailCache = new Map<string, CachedSessionDetailEntry>();
const sessionDetailInflight = new Map<string, Promise<SessionDetail>>();
const MAX_CACHED_SESSION_DETAILS = 24;

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

  const request = api.sessionDetail(sessionId, options)
    .then((detail) => {
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
    const hasFreshCache = cached?.version === versions.sessions;

    setDetail(cached?.detail ?? null);
    setLoading(!cached);
    setError(null);

    if (hasFreshCache) {
      return;
    }

    fetchSessionDetailCached(sessionId, options, versions.sessions)
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
  }, [options?.tailBlocks, sessionId, versions.sessions]);

  return { detail, loading, error };
}
