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

interface ExtensionSlashCommandContribution {
  name: string;
  description: string;
  action: string;
}

interface ExtensionContributions {
  views?: ExtensionViewContribution[];
  nav?: ExtensionNavContribution[];
  commands?: ExtensionCommandContribution[];
  slashCommands?: ExtensionSlashCommandContribution[];
  skills?: string[];
  settings?: Record<string, unknown>;
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

export interface ExtensionInstallSummary {
  id: string;
  name: string;
  packageType?: ExtensionPackageType;
  enabled: boolean;
  description?: string;
  version?: string;
  packageRoot?: string;
  manifest: ExtensionManifest;
  permissions?: string[];
  surfaces: ExtensionSurface[];
  backendActions?: ExtensionBackendActionSummary[];
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

export interface ExtensionSlashCommandRegistration {
  extensionId: string;
  surfaceId: string;
  packageType?: ExtensionPackageType;
  name: string;
  description: string;
  action: string;
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
