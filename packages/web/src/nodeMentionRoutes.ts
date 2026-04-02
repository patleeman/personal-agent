import { buildCompanionPagePath } from './companion/routes';
import type { MentionItem } from './conversationMentions';
import { buildNodesHref } from './nodeWorkspaceState';

export type NodeMentionSurface = 'main' | 'companion';

export function buildNodeMentionHref(item: MentionItem, surface: NodeMentionSurface): string | null {
  switch (item.kind) {
    case 'project':
      return surface === 'companion'
        ? buildCompanionPagePath('project', item.label)
        : buildNodesHref('project', item.label);
    case 'note':
      return surface === 'companion'
        ? buildCompanionPagePath('note', item.label)
        : buildNodesHref('note', item.label);
    case 'skill':
      return surface === 'companion'
        ? buildCompanionPagePath('skill', item.label)
        : buildNodesHref('skill', item.label);
    default:
      return null;
  }
}
