import { publishAppEvent } from '../shared/appEvents.js';
import type {
  ConversationAutoModeState,
  ConversationAutoModeStateInput,
} from './conversationAutoMode.js';
import {
  markLiveSessionAutoModeContinueRequested,
  requestLiveSessionAutoModeContinuationTurn,
  requestLiveSessionAutoModeTurn,
  writeLiveSessionAutoModeHostState,
} from './liveSessionAutoModeOps.js';
import { readConversationAutoModeState } from './liveSessionStateBroadcasts.js';

export type LiveSessionAutoModeFacadeHost = Parameters<typeof requestLiveSessionAutoModeTurn>[0]
  & Parameters<typeof readConversationAutoModeState>[0]
  & {
  sessionId: string;
};

export function readLiveSessionAutoModeState(entry: LiveSessionAutoModeFacadeHost): ConversationAutoModeState {
  return readConversationAutoModeState(entry);
}

export function broadcastConversationAutoModeState<TEntry extends LiveSessionAutoModeFacadeHost>(
  entry: TEntry | undefined,
  force: boolean,
  callbacks: {
    broadcastAutoModeState: (entry: TEntry, force?: boolean) => void;
  },
): void {
  if (!entry) {
    return;
  }

  callbacks.broadcastAutoModeState(entry, force);
}

export async function requestConversationAutoModeTurn<TEntry extends LiveSessionAutoModeFacadeHost>(
  entry: TEntry,
  callbacks: {
    publishSessionMetaChanged: (sessionId: string) => void;
  },
): Promise<boolean> {
  callbacks.publishSessionMetaChanged(entry.sessionId);
  try {
    return await requestLiveSessionAutoModeTurn(entry);
  } catch (error) {
    callbacks.publishSessionMetaChanged(entry.sessionId);
    throw error;
  }
}

export function markConversationAutoModeContinueRequested(entry: LiveSessionAutoModeFacadeHost): void {
  markLiveSessionAutoModeContinueRequested(entry);
}

export async function requestConversationAutoModeContinuationTurn(entry: LiveSessionAutoModeFacadeHost): Promise<boolean> {
  return requestLiveSessionAutoModeContinuationTurn(entry);
}

export async function setLiveSessionAutoModeState<TEntry extends LiveSessionAutoModeFacadeHost>(
  entry: TEntry,
  input: ConversationAutoModeStateInput,
  callbacks: {
    broadcastAutoModeState: (entry: TEntry, force?: boolean) => void;
    publishSessionMetaChanged: (sessionId: string) => void;
  },
): Promise<ConversationAutoModeState> {
  const nextState = writeLiveSessionAutoModeHostState(entry, input);
  callbacks.broadcastAutoModeState(entry, true);
  callbacks.publishSessionMetaChanged(entry.sessionId);
  publishAppEvent({ type: 'session_file_changed', sessionId: entry.sessionId });

  return nextState;
}
