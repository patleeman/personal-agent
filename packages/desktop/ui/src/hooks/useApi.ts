import { useCallback, useEffect, useRef, useState } from 'react';

import { addNotification } from '../components/notifications/notificationStore';

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

export interface UseApiOptions {
  notifyOnError?: boolean;
}

/**
 * useApi — fetch once on mount/key change, then support background refetches
 * without dropping the current UI back into a loading state.
 */
export function useApi<T>(fetcher: () => Promise<T>, key?: string, options: UseApiOptions = {}): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const dataRef = useRef<T | null>(null);
  const notifyOnErrorRef = useRef(options.notifyOnError ?? true);

  fetcherRef.current = fetcher;
  dataRef.current = data;
  notifyOnErrorRef.current = options.notifyOnError ?? true;

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
        if (notifyOnErrorRef.current) {
          addNotification({ type: 'error', message, details: err instanceof Error ? err.stack : undefined, source: 'core' });
        }
      }
      setLoading(false);
      setRefreshing(false);
      return null;
    }
  }, []);

  const replaceData = useCallback((nextData: T) => {
    requestIdRef.current += 1;
    dataRef.current = nextData;
    setData(nextData);
    setLoading(false);
    setRefreshing(false);
    setError(null);
  }, []);

  useEffect(() => {
    dataRef.current = null;
    setData(null);
    setError(null);
    void runFetch({ resetLoading: true });
  }, [key, runFetch]);

  return { data, loading, refreshing, error, refetch: runFetch, replaceData };
}
