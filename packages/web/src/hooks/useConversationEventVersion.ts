import { readConversationScopedEventVersion } from '../conversation/conversationEventVersions';
import { useAppEvents } from '../app/contexts';

export function useConversationEventVersion(conversationId: string | null | undefined): number {
  const { conversationVersions } = useAppEvents();
  return readConversationScopedEventVersion(conversationVersions, conversationId);
}
