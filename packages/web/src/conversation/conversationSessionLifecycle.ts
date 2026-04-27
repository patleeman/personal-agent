import { primeConversationBootstrapCache } from '../hooks/useConversationBootstrap';
import { primeSessionDetailCache } from '../hooks/useSessions';
import type { LiveSessionCreateResult } from '../shared/types';

export function isConversationSessionNotLiveError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().toLowerCase();
  return normalized === 'session not live'
    || normalized === 'not a live session'
    || normalized.startsWith('session ') && normalized.endsWith(' is not live');
}

export function primeCreatedConversationOpenCaches(
  created: LiveSessionCreateResult,
  options: {
    tailBlocks: number;
    bootstrapVersionKey: string;
    sessionDetailVersion: number;
  },
): void {
  if (!created.bootstrap) {
    return;
  }

  primeConversationBootstrapCache(
    created.id,
    created.bootstrap,
    { tailBlocks: options.tailBlocks },
    options.bootstrapVersionKey,
  );

  if (created.bootstrap.sessionDetail) {
    primeSessionDetailCache(
      created.id,
      created.bootstrap.sessionDetail,
      { tailBlocks: options.tailBlocks },
      options.sessionDetailVersion,
    );
  }
}
