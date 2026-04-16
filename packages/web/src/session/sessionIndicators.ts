import type { SessionMeta } from '../shared/types';

export function sessionNeedsAttention(session: Pick<SessionMeta, 'needsAttention' | 'isRunning'>): boolean {
  return Boolean(session.needsAttention) && !session.isRunning;
}
