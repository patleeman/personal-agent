import { buildCompanionNotePath, buildCompanionProjectPath, buildCompanionSkillPath } from './companion/routes';
import type { MentionItem } from './conversationMentions';
import { buildNodesHref } from './nodeWorkspaceState';

export type NodeMentionSurface = 'main' | 'companion';

export function buildNodeMentionHref(item: MentionItem, surface: NodeMentionSurface): string | null {
  switch (item.kind) {
    case 'project':
      return surface === 'companion'
        ? buildCompanionProjectPath(item.label)
        : buildNodesHref('project', item.label);
    case 'note':
      return surface === 'companion'
        ? buildCompanionNotePath(item.label)
        : buildNodesHref('note', item.label);
    case 'skill':
      return surface === 'companion'
        ? buildCompanionSkillPath(item.label)
        : buildNodesHref('skill', item.label);
    default:
      return null;
  }
}
