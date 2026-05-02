import { useEffect, useRef } from 'react';
import { useAppEvents } from '../app/contexts';
import type { AppEventTopic } from '../shared/types';
import type { RefetchOptions } from './useApi';

export function useInvalidateOnTopics(
  topics: AppEventTopic[],
  refetch: (options?: RefetchOptions) => Promise<unknown>,
): void {
  const { versions } = useAppEvents();
  const refetchRef = useRef(refetch);
  const mountedRef = useRef(false);

  refetchRef.current = refetch;

  const signature = topics
    .map((topic) => `${topic}:${versions[topic]}`)
    .join('|');

  useEffect(() => {
    if (topics.length === 0) {
      return;
    }

    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }

    void refetchRef.current({ resetLoading: false });
  }, [signature, topics.length]);
}
