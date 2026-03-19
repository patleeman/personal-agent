import { useCallback, useEffect, useRef, useState } from 'react';

export interface RefetchOptions {
  resetLoading?: boolean;
}

export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refetch: (options?: RefetchOptions) => Promise<T | null>;
  replaceData: (nextData: T) => void;
}

/**
 * useApi — fetch once on mount/key change, then support background refetches
 * without dropping the current UI back into a loading state.
 */
export function useApi<T>(fetcher: () => Promise<T>, key?: string): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const dataRef = useRef<T | null>(null);

  fetcherRef.current = fetcher;
  dataRef.current = data;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runFetch = useCallback(async (options?: RefetchOptions): Promise<T | null> => {
    const requestId = ++requestIdRef.current;
    const hasData = dataRef.current !== null;
    const resetLoading = options?.resetLoading ?? !hasData;

    if (resetLoading) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    if (!hasData || resetLoading) {
      setError(null);
    }

    try {
      const result = await fetcherRef.current();
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return null;
      }

      dataRef.current = result;
      setData(result);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return result;
    } catch (err) {
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return null;
      }

      const message = err instanceof Error ? err.message : String(err);
      if (!hasData || resetLoading) {
        setError(message);
      }
      setLoading(false);
      setRefreshing(false);
      return null;
    }
  }, []);

  const replaceData = useCallback((nextData: T) => {
    dataRef.current = nextData;
    setData(nextData);
    setLoading(false);
    setRefreshing(false);
    setError(null);
  }, []);

  useEffect(() => {
    void runFetch({ resetLoading: true });
  }, [key, runFetch]);

  return { data, loading, refreshing, error, refetch: runFetch, replaceData };
}

