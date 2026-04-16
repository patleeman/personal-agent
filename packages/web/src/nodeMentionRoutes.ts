import type { MentionItem } from './conversation/conversationMentions';

export type NodeMentionSurface = 'main' | 'compact';

export function buildNodeMentionHref(_item: MentionItem, _surface: NodeMentionSurface): string | null {
  return null;
}
