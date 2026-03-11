import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * useApi — fires the fetcher once on mount (and on refetch()).
 * Pass `key` to re-fire automatically when it changes (e.g. a route id).
 */
export function useApi<T>(fetcher: () => Promise<T>, key?: string): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetcherRef.current()
      .then((result) => {
        if (!cancelled) { setData(result); setLoading(false); }
      })
      .catch((err: Error) => {
        if (!cancelled) { setError(err.message); setLoading(false); }
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, key]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, refetch };
}

export function usePolling<T>(fetcher: () => Promise<T>, intervalMs = 10_000): UseApiResult<T> {
  const result = useApi(fetcher);

  useEffect(() => {
    const timer = setInterval(result.refetch, intervalMs);
    return () => clearInterval(timer);
  }, [result.refetch, intervalMs]);

  return result;
}
