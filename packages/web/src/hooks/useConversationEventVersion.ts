import { useEffect, useState } from 'react';
import { buildApiPath } from '../apiBase';

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
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setVersion(0);

    const normalizedConversationId = typeof conversationId === 'string'
      ? conversationId.trim()
      : '';
    if (!normalizedConversationId) {
      return;
    }

    const es = new EventSource(buildApiPath(`/conversations/${encodeURIComponent(normalizedConversationId)}/events`));
    es.onmessage = (event) => {
      let payload: ConversationEventStreamEvent;
      try {
        payload = JSON.parse(event.data) as ConversationEventStreamEvent;
      } catch {
        return;
      }

      if (shouldBumpConversationEventVersion(payload, normalizedConversationId)) {
        setVersion((current) => current + 1);
      }
    };

    return () => {
      es.close();
    };
  }, [conversationId]);

  return version;
}
