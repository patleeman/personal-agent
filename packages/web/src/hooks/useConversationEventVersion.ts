import { readConversationScopedEventVersion } from '../conversation/conversationEventVersions';
import { useAppEvents } from '../app/contexts';

export type ConversationEventStreamEvent =
  | { type: 'connected' }
  | { type: 'session_meta_changed'; sessionId: string }
  | { type: 'session_file_changed'; sessionId: string }
  | { type: 'live_title'; sessionId: string; title: string };

export function useConversationEventVersion(conversationId: string | null | undefined): number {
  const { conversationVersions } = useAppEvents();
  return readConversationScopedEventVersion(conversationVersions, conversationId);
}
