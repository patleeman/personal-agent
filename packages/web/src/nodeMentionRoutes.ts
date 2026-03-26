import { buildCompanionNotePath, buildCompanionProjectPath, buildCompanionSkillPath } from './companion/routes';
import type { MentionItem } from './conversationMentions';

export type NodeMentionSurface = 'main' | 'companion';

export function buildNodeMentionHref(item: MentionItem, surface: NodeMentionSurface): string | null {
  switch (item.kind) {
    case 'project':
      return surface === 'companion'
        ? buildCompanionProjectPath(item.label)
        : `/projects/${encodeURIComponent(item.label)}`;
    case 'note':
      return surface === 'companion'
        ? buildCompanionNotePath(item.label)
        : `/notes?note=${encodeURIComponent(item.label)}`;
    case 'skill':
      return surface === 'companion'
        ? buildCompanionSkillPath(item.label)
        : `/skills?skill=${encodeURIComponent(item.label)}`;
    default:
      return null;
  }
}
