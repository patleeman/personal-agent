import type { PersonalAgentClient } from '@personal-agent/extensions';
import { useEffect } from 'react';

interface EnsureResult {
  created?: boolean;
  conversationId?: string;
}

export function OnboardingBootstrap({ pa }: { pa: PersonalAgentClient }) {
  useEffect(() => {
    let cancelled = false;
    void pa.extension
      .invoke('ensure')
      .then((result) => {
        if (cancelled) return;
        const ensureResult = result as EnsureResult;
        if (ensureResult.conversationId) {
          window.location.assign(`/conversations/${encodeURIComponent(ensureResult.conversationId)}`);
        }
      })
      .catch((error) => {
        console.warn('[system-onboarding] failed to ensure onboarding conversation', error);
      });
    return () => {
      cancelled = true;
    };
  }, [pa]);

  return null;
}
