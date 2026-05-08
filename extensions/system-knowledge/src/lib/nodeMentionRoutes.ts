import type { MentionItem } from '../../../../packages/desktop/ui/src/conversation/conversationMentions';

export type NodeMentionSurface = 'main' | 'compact';

export function buildNodeMentionHref(_item: MentionItem, _surface: NodeMentionSurface): string | null {
  return null;
}
