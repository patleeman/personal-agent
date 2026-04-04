import type { MentionItem } from './conversationMentions';

export type NodeMentionSurface = 'main' | 'companion';

export function buildNodeMentionHref(_item: MentionItem, _surface: NodeMentionSurface): string | null {
  return null;
}
