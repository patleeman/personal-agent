export type ConversationScopedEventVersions = ReadonlyMap<string, number>;

const MAX_TRACKED_CONVERSATION_EVENT_VERSIONS = 256;

function trimConversationEventVersionMap(map: Map<string, number>): void {
  while (map.size > MAX_TRACKED_CONVERSATION_EVENT_VERSIONS) {
    const oldestKey = map.keys().next().value;
    if (!oldestKey) {
      break;
    }

    map.delete(oldestKey);
  }
}

export const INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS: ConversationScopedEventVersions = new Map();

export function readConversationScopedEventVersion(
  versions: ConversationScopedEventVersions,
  sessionId: string | null | undefined,
): number {
  const normalizedSessionId = sessionId?.trim();
  if (!normalizedSessionId) {
    return 0;
  }

  return versions.get(normalizedSessionId) ?? 0;
}

export function bumpConversationScopedEventVersions(
  versions: ConversationScopedEventVersions,
  sessionId: string | null | undefined,
): ConversationScopedEventVersions {
  const normalizedSessionId = sessionId?.trim();
  if (!normalizedSessionId) {
    return versions;
  }

  const next = new Map(versions);
  const previous = next.get(normalizedSessionId) ?? 0;
  next.delete(normalizedSessionId);
  next.set(normalizedSessionId, previous + 1);
  trimConversationEventVersionMap(next);
  return next;
}
