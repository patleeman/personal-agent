import type { AgentSession } from '@earendil-works/pi-coding-agent';

import { type QueuedPromptPreview, readQueueState } from './liveSessionQueue.js';
import { hasQueuedOrActiveStaleTurn, type LiveSessionStaleTurnState } from './liveSessionStaleTurns.js';

export interface LiveSessionQueueReadHost extends LiveSessionStaleTurnState {
  session: AgentSession;
}

export function canInjectResumeFallbackPrompt(entry: LiveSessionQueueReadHost | undefined): boolean {
  if (!entry) {
    return false;
  }

  if (entry.session.isStreaming || hasQueuedOrActiveStaleTurn(entry)) {
    return false;
  }

  const steering = typeof entry.session.getSteeringMessages === 'function' ? entry.session.getSteeringMessages() : [];
  if (steering.length > 0) {
    return false;
  }

  const followUp = typeof entry.session.getFollowUpMessages === 'function' ? entry.session.getFollowUpMessages() : [];
  return followUp.length === 0;
}

export function listQueuedPromptPreviews(entry: LiveSessionQueueReadHost): {
  steering: QueuedPromptPreview[];
  followUp: QueuedPromptPreview[];
} {
  return readQueueState(entry.session);
}
