export const EXTENSION_MANIFEST_VERSION = 1;

export const EXTENSION_PACKAGE_TYPES = ['user', 'system'] as const;
export type ExtensionPackageType = (typeof EXTENSION_PACKAGE_TYPES)[number];

export const EXTENSION_PLACEMENTS = ['left', 'main', 'right', 'conversation', 'command', 'slash'] as const;
export type ExtensionPlacement = (typeof EXTENSION_PLACEMENTS)[number];

export const EXTENSION_SURFACE_KINDS = ['navItem', 'navSection', 'page', 'toolPanel', 'inlineAction', 'command', 'slashCommand'] as const;
export type ExtensionSurfaceKind = (typeof EXTENSION_SURFACE_KINDS)[number];

export const EXTENSION_RIGHT_SURFACE_SCOPES = ['global', 'conversation', 'workspace', 'selection'] as const;
export type ExtensionRightSurfaceScope = (typeof EXTENSION_RIGHT_SURFACE_SCOPES)[number];

export const EXTENSION_ICON_NAMES = [
  'app',
  'automation',
  'browser',
  'database',
  'diff',
  'file',
  'gear',
  'graph',
  'kanban',
  'play',
  'sparkle',
  'terminal',
] as const;
export type ExtensionIconName = (typeof EXTENSION_ICON_NAMES)[number];

export const EXTENSION_PERMISSIONS = [
  'runs:read',
  'runs:start',
  'runs:cancel',
  'storage:read',
  'storage:write',
  'storage:readwrite',
  'vault:read',
  'vault:write',
  'vault:readwrite',
  'conversations:read',
  'conversations:write',
  'conversations:readwrite',
  'ui:notify',
] as const;
export type ExtensionPermission = (typeof EXTENSION_PERMISSIONS)[number] | `${string}:${string}`;

export interface ExtensionManifest {
  schemaVersion: typeof EXTENSION_MANIFEST_VERSION;
  id: string;
  name: string;
  packageType?: ExtensionPackageType;
  description?: string;
  version?: string;
  surfaces?: ExtensionSurface[];
  backend?: ExtensionBackend;
  permissions?: ExtensionPermission[];
}

export type ExtensionSurface =
  | ExtensionLeftNavItemSurface
  | ExtensionLeftNavSectionSurface
  | ExtensionMainPageSurface
  | ExtensionRightToolPanelSurface
  | ExtensionConversationInlineActionSurface
  | ExtensionCommandSurface
  | ExtensionSlashCommandSurface;

interface ExtensionSurfaceBase {
  id: string;
  placement: ExtensionPlacement;
  kind: ExtensionSurfaceKind;
  title?: string;
  label?: string;
  icon?: ExtensionIconName;
  action?: string;
}

export interface ExtensionLeftNavItemSurface extends ExtensionSurfaceBase {
  placement: 'left';
  kind: 'navItem';
  label: string;
  route: string;
  icon?: ExtensionIconName;
  badgeAction?: string;
}

export interface ExtensionLeftNavSectionSurface extends ExtensionSurfaceBase {
  placement: 'left';
  kind: 'navSection';
  label: string;
  icon?: ExtensionIconName;
  items?: Array<{ label: string; route: string; icon?: ExtensionIconName; badgeAction?: string }>;
}

export interface ExtensionMainPageSurface extends ExtensionSurfaceBase {
  placement: 'main';
  kind: 'page';
  route: string;
  entry?: string;
}

export interface ExtensionRightToolPanelSurface extends ExtensionSurfaceBase {
  placement: 'right';
  kind: 'toolPanel';
  label: string;
  entry: string;
  scope: ExtensionRightSurfaceScope;
  icon?: ExtensionIconName;
  defaultOpen?: boolean;
}

export interface ExtensionConversationInlineActionSurface extends ExtensionSurfaceBase {
  placement: 'conversation';
  kind: 'inlineAction';
  label: string;
  action: string;
  icon?: ExtensionIconName;
  when?: 'message' | 'selection' | 'composer';
}

export interface ExtensionCommandSurface extends ExtensionSurfaceBase {
  placement: 'command';
  kind: 'command';
  title: string;
  action: string;
  icon?: ExtensionIconName;
}

export interface ExtensionSlashCommandSurface extends ExtensionSurfaceBase {
  placement: 'slash';
  kind: 'slashCommand';
  name: string;
  description: string;
  action: string;
}

export interface ExtensionBackend {
  entry: string;
  actions?: ExtensionBackendAction[];
}

export interface ExtensionBackendAction {
  id: string;
  handler: string;
  title?: string;
  description?: string;
}

export function isExtensionPlacement(value: string): value is ExtensionPlacement {
  return (EXTENSION_PLACEMENTS as readonly string[]).includes(value);
}

export function isExtensionSurfaceKind(value: string): value is ExtensionSurfaceKind {
  return (EXTENSION_SURFACE_KINDS as readonly string[]).includes(value);
}

export function isExtensionIconName(value: string): value is ExtensionIconName {
  return (EXTENSION_ICON_NAMES as readonly string[]).includes(value);
}
