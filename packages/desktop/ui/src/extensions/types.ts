type ExtensionPackageType = 'user' | 'system';
type ExtensionIconName =
  | 'app'
  | 'automation'
  | 'browser'
  | 'database'
  | 'diff'
  | 'file'
  | 'gear'
  | 'graph'
  | 'kanban'
  | 'play'
  | 'sparkle'
  | 'terminal';
type ExtensionRightSurfaceScope = 'global' | 'conversation' | 'workspace' | 'selection';
export type ExtensionRouteCapability = 'contextRail' | 'workbench' | 'workbenchFilePane' | 'knowledgeFiles' | 'settingsSection';

interface ExtensionBackendActionSummary {
  id: string;
  handler: string;
  title?: string;
  description?: string;
}

interface ExtensionFrontendManifest {
  entry: string;
  styles?: string[];
}

interface ExtensionPromptReferenceContribution {
  id: string;
  handler: string;
  title?: string;
}

interface ExtensionQuickOpenContribution {
  id: string;
  provider: string;
  title?: string;
  section?: string;
}

interface ExtensionViewContribution {
  id: string;
  title: string;
  location: 'main' | 'rightRail' | 'workbench';
  component: string;
  route?: string;
  scope?: ExtensionRightSurfaceScope;
  icon?: ExtensionIconName;
  defaultOpen?: boolean;
  detailView?: string;
  routeCapabilities?: ExtensionRouteCapability[];
}

interface ExtensionNavContribution {
  id: string;
  label: string;
  route: string;
  icon?: ExtensionIconName;
  badgeAction?: string;
}

interface ExtensionCommandContribution {
  id: string;
  title: string;
  action: string;
  icon?: ExtensionIconName;
}

interface ExtensionKeybindingContribution {
  id: string;
  title: string;
  keys: string[];
  command: string;
  when?: string;
  scope?: 'global' | 'surface';
}

interface ExtensionSlashCommandContribution {
  name: string;
  description: string;
  action: string;
}

interface ExtensionSkillContribution {
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

interface ExtensionToolContribution {
  id: string;
  title?: string;
  label?: string;
  description: string;
  action?: string;
  handler?: string;
  inputSchema?: Record<string, unknown>;
  promptSnippet?: string;
  promptGuidelines?: string[];
  systemFactory?: string;
  name?: string;
}

interface ExtensionMentionContribution {
  id: string;
  title: string;
  description?: string;
  kinds: string[];
  provider: string;
}

interface ExtensionContributions {
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
  settings?: Record<string, unknown>;
}

interface ExtensionThemeContribution {
  id: string;
  label: string;
  appearance: 'light' | 'dark';
  tokens: Record<string, string>;
}

interface LegacyExtensionSurfaceBase {
  id: string;
  placement: 'left' | 'main' | 'right' | 'conversation' | 'command' | 'slash';
  kind: 'navItem' | 'navSection' | 'page' | 'toolPanel' | 'inlineAction' | 'command' | 'slashCommand';
  title?: string;
  label?: string;
  icon?: ExtensionIconName;
  action?: string;
}

export interface ExtensionLeftNavItemSurface extends LegacyExtensionSurfaceBase {
  placement: 'left';
  kind: 'navItem';
  label: string;
  route: string;
  icon?: ExtensionIconName;
  badgeAction?: string;
}

interface ExtensionMainPageSurface extends LegacyExtensionSurfaceBase {
  placement: 'main';
  kind: 'page';
  route: string;
  entry?: string;
}

export interface ExtensionRightToolPanelSurface extends LegacyExtensionSurfaceBase {
  placement: 'right';
  kind: 'toolPanel';
  label: string;
  entry: string;
  scope: ExtensionRightSurfaceScope;
  icon?: ExtensionIconName;
  defaultOpen?: boolean;
}

type ExtensionSurface =
  | ExtensionLeftNavItemSurface
  | ExtensionMainPageSurface
  | ExtensionRightToolPanelSurface
  | (LegacyExtensionSurfaceBase & Record<string, unknown>);

export interface ExtensionManifest {
  schemaVersion: 1 | 2;
  id: string;
  name: string;
  packageType?: ExtensionPackageType;
  description?: string;
  version?: string;
  frontend?: ExtensionFrontendManifest;
  contributes?: ExtensionContributions;
  surfaces?: ExtensionSurface[];
  permissions?: string[];
  backend?: {
    entry: string;
    actions?: ExtensionBackendActionSummary[];
  };
}

interface ExtensionSkillRegistration {
  extensionId: string;
  packageType?: ExtensionPackageType;
  id: string;
  name: string;
  title?: string;
  description?: string;
  path: string;
  packageRoot: string;
}

export interface ExtensionMentionRegistration {
  extensionId: string;
  packageType?: ExtensionPackageType;
  id: string;
  title: string;
  description?: string;
  kinds: string[];
  provider: string;
}

interface ExtensionToolRegistration {
  extensionId: string;
  packageType?: ExtensionPackageType;
  id: string;
  name: string;
  action: string;
  title?: string;
  label?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  promptSnippet?: string;
  promptGuidelines?: string[];
  systemFactory?: string;
}

export interface ExtensionInstallSummary {
  id: string;
  name: string;
  packageType?: ExtensionPackageType;
  enabled: boolean;
  status?: 'enabled' | 'disabled' | 'invalid';
  errors?: string[];
  diagnostics?: string[];
  description?: string;
  version?: string;
  packageRoot?: string;
  manifest: ExtensionManifest;
  permissions?: string[];
  surfaces: ExtensionSurface[];
  backendActions?: ExtensionBackendActionSummary[];
  skills?: ExtensionSkillRegistration[];
  mentions?: ExtensionMentionRegistration[];
  tools?: ExtensionToolRegistration[];
  routes: Array<{ route: string; surfaceId: string }>;
}

export interface ExtensionRouteSummary {
  route: string;
  extensionId: string;
  surfaceId: string;
  packageType?: ExtensionPackageType;
}

export interface ExtensionCommandRegistration {
  extensionId: string;
  surfaceId: string;
  packageType?: ExtensionPackageType;
  title: string;
  action: string;
  icon?: string;
}

export interface ExtensionKeybindingRegistration {
  extensionId: string;
  surfaceId: string;
  packageType?: ExtensionPackageType;
  title: string;
  keys: string[];
  command: string;
  when?: string;
  scope: 'global' | 'surface';
  defaultKeys: string[];
  enabled: boolean;
}

export interface ExtensionSlashCommandRegistration {
  extensionId: string;
  surfaceId: string;
  packageType?: ExtensionPackageType;
  name: string;
  description: string;
  action: string;
}

export interface ExtensionQuickOpenRegistration {
  extensionId: string;
  id: string;
  provider: string;
  packageType?: ExtensionPackageType;
  title?: string;
  section?: string;
}

export type ExtensionSurfaceSummary = ExtensionSurface & { extensionId: string; packageType?: ExtensionPackageType };
export type NativeExtensionViewSummary = ExtensionViewContribution & {
  extensionId: string;
  packageType?: ExtensionPackageType;
  frontend?: ExtensionFrontendManifest;
};
export function isExtensionLeftNavItemSurface(
  surface: ExtensionSurfaceSummary,
): surface is ExtensionLeftNavItemSurface & ExtensionSurfaceSummary {
  return (
    surface.placement === 'left' && surface.kind === 'navItem' && typeof surface.route === 'string' && typeof surface.label === 'string'
  );
}

export function isExtensionRightToolPanelSurface(
  surface: ExtensionSurfaceSummary,
): surface is ExtensionRightToolPanelSurface & ExtensionSurfaceSummary {
  return (
    surface.placement === 'right' &&
    surface.kind === 'toolPanel' &&
    typeof surface.label === 'string' &&
    typeof surface.entry === 'string' &&
    typeof surface.scope === 'string'
  );
}

function isNativeExtensionViewSurface(surface: unknown): surface is NativeExtensionViewSummary {
  return Boolean(
    surface &&
    typeof surface === 'object' &&
    'extensionId' in surface &&
    'location' in surface &&
    'component' in surface &&
    typeof (surface as NativeExtensionViewSummary).component === 'string',
  );
}

export function isNativeExtensionPageSurface(
  surface: unknown,
): surface is NativeExtensionViewSummary & { route: string; location: 'main' } {
  return isNativeExtensionViewSurface(surface) && surface.location === 'main' && typeof surface.route === 'string';
}

export function isNativeExtensionRightRailSurface(
  surface: unknown,
): surface is NativeExtensionViewSummary & { location: 'rightRail'; scope: ExtensionRightSurfaceScope } {
  return isNativeExtensionViewSurface(surface) && surface.location === 'rightRail' && typeof surface.scope === 'string';
}

export function isNativeExtensionWorkbenchSurface(surface: unknown): surface is NativeExtensionViewSummary & { location: 'workbench' } {
  return isNativeExtensionViewSurface(surface) && surface.location === 'workbench';
}
