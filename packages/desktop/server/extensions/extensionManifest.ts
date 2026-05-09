export const EXTENSION_MANIFEST_VERSION = 2;

export const EXTENSION_PACKAGE_TYPES = ['user', 'system'] as const;
export type ExtensionPackageType = (typeof EXTENSION_PACKAGE_TYPES)[number];

export const EXTENSION_PLACEMENTS = ['left', 'main', 'right', 'conversation', 'command', 'slash'] as const;
export type ExtensionPlacement = (typeof EXTENSION_PLACEMENTS)[number];

export const EXTENSION_SURFACE_KINDS = ['navItem', 'navSection', 'page', 'toolPanel', 'inlineAction', 'command', 'slashCommand'] as const;
export type ExtensionSurfaceKind = (typeof EXTENSION_SURFACE_KINDS)[number];

export const EXTENSION_RIGHT_SURFACE_SCOPES = ['global', 'conversation', 'workspace', 'selection'] as const;
export type ExtensionRightSurfaceScope = (typeof EXTENSION_RIGHT_SURFACE_SCOPES)[number];

export const EXTENSION_VIEW_PLACEMENTS = ['primary', 'workbench-tool'] as const;
export type ExtensionViewPlacement = (typeof EXTENSION_VIEW_PLACEMENTS)[number];

export const EXTENSION_VIEW_SCOPES = ['global', 'workspace', 'conversation'] as const;
export type ExtensionViewScope = (typeof EXTENSION_VIEW_SCOPES)[number];

export const EXTENSION_VIEW_ACTIVATIONS = ['always', 'on-route', 'on-open', 'on-demand'] as const;
export type ExtensionViewActivation = (typeof EXTENSION_VIEW_ACTIVATIONS)[number];

export const EXTENSION_ROUTE_CAPABILITIES = ['contextRail', 'workbench', 'workbenchFilePane', 'knowledgeFiles', 'settingsSection'] as const;
export type ExtensionRouteCapability = (typeof EXTENSION_ROUTE_CAPABILITIES)[number];

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
  schemaVersion: 1 | typeof EXTENSION_MANIFEST_VERSION;
  id: string;
  name: string;
  packageType?: ExtensionPackageType;
  description?: string;
  version?: string;
  frontend?: ExtensionFrontend;
  contributes?: ExtensionContributions;
  surfaces?: ExtensionSurface[];
  backend?: ExtensionBackend;
  permissions?: ExtensionPermission[];
}

export interface ExtensionFrontend {
  entry: string;
  styles?: string[];
}

export interface ExtensionContributions {
  views?: ExtensionViewContribution[];
  nav?: ExtensionNavContribution[];
  commands?: ExtensionCommandContribution[];
  keybindings?: ExtensionKeybindingContribution[];
  slashCommands?: ExtensionSlashCommandContribution[];
  mentions?: ExtensionMentionContribution[];
  skills?: Array<string | ExtensionSkillContribution>;
  tools?: ExtensionToolContribution[];
  transcriptRenderers?: ExtensionTranscriptRendererContribution[];
  promptReferences?: ExtensionPromptReferenceContribution[];
  quickOpen?: ExtensionQuickOpenContribution[];
  themes?: ExtensionThemeContribution[];
  topBarElements?: ExtensionTopBarElementContribution[];
  messageActions?: ExtensionMessageActionContribution[];
  composerShelves?: ExtensionComposerShelfContribution[];
  toolbarActions?: ExtensionToolbarActionContribution[];
  contextMenus?: ExtensionContextMenuContribution[];
  statusBarItems?: ExtensionStatusBarItemContribution[];
  conversationHeaderElements?: ExtensionConversationHeaderContribution[];
  conversationDecorators?: ExtensionConversationDecoratorContribution[];
  settings?: Record<string, ExtensionSettingsContribution>;
}

export interface ExtensionTopBarElementContribution {
  id: string;
  component: string;
  label?: string;
}

export interface ExtensionMessageActionContribution {
  id: string;
  title: string;
  action: string;
  when?: string;
  priority?: number;
}

export interface ExtensionComposerShelfContribution {
  id: string;
  component: string;
  title?: string;
  placement?: 'top' | 'bottom';
}

export interface ExtensionToolbarActionContribution {
  id: string;
  title: string;
  icon: ExtensionIconName;
  action: string;
  when?: string;
  priority?: number;
}

export interface ExtensionConversationHeaderContribution {
  id: string;
  component: string;
  label?: string;
}

export interface ExtensionStatusBarItemContribution {
  id: string;
  label: string;
  action?: string;
  alignment?: 'left' | 'right';
  priority?: number;
}

export interface ExtensionContextMenuContribution {
  id: string;
  title: string;
  action: string;
  surface: 'message' | 'conversationList';
  separator?: boolean;
  when?: string;
}

export interface ExtensionSettingsContribution {
  type: 'string' | 'boolean' | 'number' | 'select';
  default?: unknown;
  description?: string;
  group?: string;
  enum?: string[];
  placeholder?: string;
  order?: number;
}

export interface ExtensionConversationDecoratorContribution {
  id: string;
  component: string;
  position: 'before-title' | 'after-title' | 'subtitle';
  priority?: number;
}

export interface ExtensionThemeContribution {
  id: string;
  label: string;
  appearance: 'light' | 'dark';
  tokens: Record<string, string>;
}

export interface ExtensionPromptReferenceContribution {
  id: string;
  handler: string;
  title?: string;
}

export interface ExtensionQuickOpenContribution {
  id: string;
  provider: string;
  title?: string;
  section?: string;
}

export interface ExtensionViewContribution {
  id: string;
  title: string;
  location: 'main' | 'rightRail' | 'workbench';
  component: string;
  route?: string;
  scope?: ExtensionRightSurfaceScope | ExtensionViewScope;
  icon?: ExtensionIconName;
  placement?: ExtensionViewPlacement;
  activation?: ExtensionViewActivation;
  defaultOpen?: boolean;
  persistOpen?: boolean;
  /** For rightRail views, optional paired workbench view id rendered in the center pane while this rail tool is active. */
  detailView?: string;
  /** Optional host layout behaviors enabled when this main view's route is active. */
  routeCapabilities?: ExtensionRouteCapability[];
}

export interface ExtensionNavContribution {
  id: string;
  label: string;
  route: string;
  icon?: ExtensionIconName;
  badgeAction?: string;
  section?: 'primary' | 'settings';
}

export interface ExtensionCommandContribution {
  id: string;
  title: string;
  action: string;
  icon?: ExtensionIconName;
}

export interface ExtensionKeybindingContribution {
  id: string;
  title: string;
  keys: string[];
  command: string;
  when?: string;
  scope?: 'global' | 'surface';
}

export interface ExtensionSlashCommandContribution {
  name: string;
  description: string;
  action: string;
}

export interface ExtensionMentionContribution {
  id: string;
  title: string;
  description?: string;
  kinds: Array<'task' | 'note' | 'folder' | 'file' | 'skill' | 'profile' | string>;
  provider: string;
}

export interface ExtensionSkillContribution {
  id: string;
  title?: string;
  description?: string;
  path: string;
}

export interface ExtensionTranscriptRendererContribution {
  id: string;
  tool: string;
  component: string;
}

export interface ExtensionToolContribution {
  id: string;
  title?: string;
  label?: string;
  description: string;
  action?: string;
  handler?: string;
  inputSchema?: Record<string, unknown>;
  promptSnippet?: string;
  promptGuidelines?: string[];
  /** Explicit agent tool name. Defaults to extension_{extensionId}_{toolId}. */
  name?: string;
  /**
   * Name of a built-in tool to replace (e.g. "bash", "read", "write", "edit").
   * When set, this tool overrides the built-in tool of that name.
   * The extension must have the same permission level as the tool it replaces.
   */
  replaces?: string;
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
  /** Optional export for backend-only agent lifecycle extensions. */
  agentExtension?: string;
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
