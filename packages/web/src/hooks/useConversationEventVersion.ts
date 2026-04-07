import { readConversationScopedEventVersion } from '../conversationEventVersions';
import { useAppEvents } from '../contexts';

export type ConversationEventStreamEvent =
  | { type: 'connected' }
  | { type: 'session_meta_changed'; sessionId: string }
  | { type: 'session_file_changed'; sessionId: string }
  | { type: 'live_title'; sessionId: string; title: string };

export function shouldBumpConversationEventVersion(
  payload: ConversationEventStreamEvent,
  conversationId: string,
): boolean {
  return (
    (payload.type === 'session_meta_changed' || payload.type === 'session_file_changed')
    && payload.sessionId === conversationId
  );
}

export function useConversationEventVersion(conversationId: string | null | undefined): number {
  const { conversationVersions } = useAppEvents();
  return readConversationScopedEventVersion(conversationVersions, conversationId);
}
