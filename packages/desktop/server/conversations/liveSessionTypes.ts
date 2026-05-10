import type { AgentSession } from '@earendil-works/pi-coding-agent';

import type { WebLiveConversationRunState } from './conversationRuns.js';
import type { LiveSessionHiddenTurnState } from './liveSessionHiddenTurns.js';
import type { ParallelPromptJob } from './liveSessionParallelJobs.js';
import type { LiveSessionPresenceHost } from './liveSessionPresence.js';
import type { LiveSessionSubscriptionListener } from './liveSessionSubscription.js';

export type LiveListener = LiveSessionSubscriptionListener;

import type { LiveSessionLifecycleHandler } from './liveSessionLifecycle.js';

export interface LiveEntry extends LiveSessionPresenceHost, LiveSessionHiddenTurnState {
  sessionId: string;
  session: AgentSession;
  cwd: string;
  listeners: Set<LiveListener>;
  title: string;
  lastContextUsageJson: string | null;
  lastQueueStateJson: string | null;
  lastParallelStateJson?: string | null;
  currentTurnError?: string | null;
  lastDurableRunState?: WebLiveConversationRunState;
  contextUsageTimer?: ReturnType<typeof setTimeout>;
  pendingAutoCompactionReason?: 'overflow' | 'threshold' | null;
  lastCompactionSummaryTitle?: string | null;
  isCompacting?: boolean;
  running: boolean;
  traceRunId?: string | null;
  traceRunStartedAtMs?: number | null;
  traceRunTurnCount?: number;
  traceRunStepCount?: number;
  traceRunFirstAssistantAtMs?: number | null;
  traceRunFirstToolAtMs?: number | null;
  lifecycleHandlers: Array<LiveSessionLifecycleHandler>;
  parallelJobs?: ParallelPromptJob[];
  importingParallelJobs?: boolean;
}
