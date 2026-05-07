export type ExtensionPackageType = 'user' | 'system';
export type ExtensionIconName =
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
export type ExtensionSurfaceKind = 'navItem' | 'navSection' | 'page' | 'toolPanel' | 'inlineAction' | 'command' | 'slashCommand';
export type ExtensionPlacement = 'left' | 'main' | 'right' | 'conversation' | 'command' | 'slash';
export type ExtensionRightSurfaceScope = 'global' | 'conversation' | 'workspace' | 'selection';
export type ExtensionSystemComponentKey = 'automations';

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

export interface ExtensionMainPageSurface extends ExtensionSurfaceBase {
  placement: 'main';
  kind: 'page';
  route: string;
  entry?: string;
  component?: ExtensionSystemComponentKey;
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

export type ExtensionSurface =
  | ExtensionLeftNavItemSurface
  | ExtensionMainPageSurface
  | ExtensionRightToolPanelSurface
  | (ExtensionSurfaceBase & Record<string, unknown>);

export interface ExtensionManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  packageType?: ExtensionPackageType;
  description?: string;
  version?: string;
  surfaces?: ExtensionSurface[];
  permissions?: string[];
}

export interface ExtensionBackendActionSummary {
  id: string;
  handler: string;
  title?: string;
  description?: string;
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

export function isExtensionLeftNavItemSurface(
  surface: ExtensionSurfaceSummary,
): surface is ExtensionLeftNavItemSurface & ExtensionSurfaceSummary {
  return (
    surface.placement === 'left' && surface.kind === 'navItem' && typeof surface.route === 'string' && typeof surface.label === 'string'
  );
}

export function isExtensionPageSurface(surface: ExtensionSurfaceSummary): surface is ExtensionMainPageSurface & ExtensionSurfaceSummary {
  return surface.placement === 'main' && surface.kind === 'page' && typeof surface.route === 'string';
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
