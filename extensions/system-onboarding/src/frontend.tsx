import type { PersonalAgentClient } from '@personal-agent/extensions';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

interface EnsureResult {
  created?: boolean;
  conversationId?: string;
  shouldOpen?: boolean;
}

function canAutoOpenOnboarding(pathname: string): boolean {
  return pathname === '/' || pathname === '/conversations' || pathname === '/conversations/new';
}

export function OnboardingBootstrap({ pa }: { pa: PersonalAgentClient }) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  const location = useLocation();
  const pathnameRef = useRef(location.pathname);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    const startedPathname = pathnameRef.current;
    let cancelled = false;
    void pa.extension
      .invoke('ensure', { source: 'frontend' })
      .then((result) => {
        if (cancelled) return;
        const ensureResult = result as EnsureResult;
        if (!ensureResult.conversationId || ensureResult.shouldOpen !== true) {
          return;
        }
        const target = `/conversations/${encodeURIComponent(ensureResult.conversationId)}`;
        const currentPathname = pathnameRef.current;
        if (!canAutoOpenOnboarding(startedPathname) && startedPathname !== target) {
          return;
        }
        if (currentPathname !== startedPathname && currentPathname !== target) {
          return;
        }
        if (currentPathname !== target) {
          navigateRef.current(target, { replace: true });
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
