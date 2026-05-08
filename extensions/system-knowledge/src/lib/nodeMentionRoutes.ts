import type { MentionItem } from '@personal-agent/extensions/knowledge';

export type NodeMentionSurface = 'main' | 'compact';

export function buildNodeMentionHref(_item: MentionItem, _surface: NodeMentionSurface): string | null {
  return null;
}
