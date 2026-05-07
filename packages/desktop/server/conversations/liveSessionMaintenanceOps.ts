import type { Api, Model } from '@earendil-works/pi-ai';
import type { AgentSession } from '@earendil-works/pi-coding-agent';

import { readSavedModelPreferences } from '../models/modelPreferences.js';
import {
  applyConversationModelPreferencesToLiveSession,
  type ConversationModelPreferenceInput,
  type ConversationModelPreferenceState,
} from './conversationModelPreferences.js';
import type { WebLiveConversationRunState } from './conversationRuns.js';
import { applyLiveSessionServiceTier } from './liveSessionModels.js';
import { resolveCompactionSummaryTitle } from './liveSessionTranscript.js';

export interface LiveSessionMaintenanceHost {
  sessionId: string;
  session: AgentSession;
  title: string;
  lastCompactionSummaryTitle?: string | null;
  lastDurableRunState?: WebLiveConversationRunState;
}

export async function compactLiveSession<TEntry extends LiveSessionMaintenanceHost>(
  entry: TEntry,
  customInstructions: string | undefined,
  callbacks: {
    broadcastSnapshot: (entry: TEntry) => void;
    clearContextUsageTimer: (entry: TEntry) => void;
    broadcastContextUsage: (entry: TEntry, force?: boolean) => void;
    publishSessionMetaChanged: (sessionId: string) => void;
  },
): Promise<unknown> {
  const result = await entry.session.compact(customInstructions);
  entry.lastCompactionSummaryTitle = resolveCompactionSummaryTitle({ mode: 'manual' });
  callbacks.broadcastSnapshot(entry);
  callbacks.clearContextUsageTimer(entry);
  callbacks.broadcastContextUsage(entry, true);
  callbacks.publishSessionMetaChanged(entry.sessionId);
  return result;
}

export function renameLiveSession<TEntry extends LiveSessionMaintenanceHost>(
  entry: TEntry,
  name: string,
  callbacks: {
    applySessionTitle: (entry: TEntry, title: string) => void;
    syncDurableConversationRun: (entry: TEntry, state: WebLiveConversationRunState, input: { force?: boolean }) => Promise<void>;
  },
): void {
  callbacks.applySessionTitle(entry, name);
  void callbacks.syncDurableConversationRun(entry, entry.lastDurableRunState ?? (entry.session.isStreaming ? 'running' : 'waiting'), {
    force: true,
  });
}

export async function updateLiveSessionModelPreferences<TEntry extends LiveSessionMaintenanceHost>(input: {
  entry: TEntry;
  preferences: ConversationModelPreferenceInput;
  availableModels: Model<Api>[];
  settingsFile: string;
  publishSessionMetaChanged: (sessionId: string) => void;
}): Promise<ConversationModelPreferenceState> {
  const next = await applyConversationModelPreferencesToLiveSession(
    input.entry.session,
    input.preferences,
    {
      currentModel: input.entry.session.model?.id ?? '',
      currentThinkingLevel: input.entry.session.thinkingLevel ?? '',
      currentServiceTier: readSavedModelPreferences(input.settingsFile, input.availableModels).currentServiceTier,
    },
    input.availableModels,
  );

  applyLiveSessionServiceTier(input.entry.session, next.currentServiceTier);
  input.publishSessionMetaChanged(input.entry.sessionId);
  return next;
}
