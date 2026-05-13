import { useEffect, useRef } from 'react';

import { useAppEvents } from '../app/contexts';
import type { AppEventTopic } from '../shared/types';
import type { RefetchOptions } from './useApi';

export function useInvalidateOnTopics(topics: AppEventTopic[], refetch: (options?: RefetchOptions) => Promise<unknown>): void {
  const { versions } = useAppEvents();
  const refetchRef = useRef(refetch);
  const previousSignatureRef = useRef<string | null>(null);

  refetchRef.current = refetch;

  const signature = topics.map((topic) => `${topic}:${versions[topic]}`).join('|');

  useEffect(() => {
    if (topics.length === 0) {
      previousSignatureRef.current = null;
      return;
    }

    if (previousSignatureRef.current === null) {
      previousSignatureRef.current = signature;
      return;
    }

    if (previousSignatureRef.current === signature) {
      return;
    }

    previousSignatureRef.current = signature;
    void refetchRef.current({ resetLoading: false }).catch(() => {});
  }, [signature, topics.length]);
}
