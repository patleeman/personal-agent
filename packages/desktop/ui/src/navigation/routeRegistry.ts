import { type ExtensionRouteCapability, type ExtensionSurfaceSummary, isNativeExtensionPageSurface } from '../extensions/types';

interface AppRoutePattern {
  id: string;
  prefix: string;
  capabilities: ExtensionRouteCapability[];
}

const CORE_ROUTE_PATTERNS: AppRoutePattern[] = [
  { id: 'conversations', prefix: '/conversations', capabilities: ['contextRail', 'workbench', 'workbenchFilePane'] },
  { id: 'extensions', prefix: '/extensions', capabilities: ['contextRail'] },
  { id: 'settings', prefix: '/settings', capabilities: ['settingsSection'] },
];

export function routeMatchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function extensionRouteHasCapability(pathname: string, capability: ExtensionRouteCapability, surfaces: ExtensionSurfaceSummary[]): boolean {
  return surfaces.some((surface) => {
    if (!isNativeExtensionPageSurface(surface) || !routeMatchesPrefix(pathname, surface.route)) {
      return false;
    }

    if ((surface.routeCapabilities ?? []).includes(capability)) {
      return true;
    }

    return capability === 'contextRail';
  });
}

function routeHasCapability(pathname: string, capability: ExtensionRouteCapability, surfaces: ExtensionSurfaceSummary[] = []): boolean {
  return (
    CORE_ROUTE_PATTERNS.some((route) => route.capabilities.includes(capability) && routeMatchesPrefix(pathname, route.prefix)) ||
    extensionRouteHasCapability(pathname, capability, surfaces)
  );
}

export function routeIsKnowledge(pathname: string, surfaces: ExtensionSurfaceSummary[] = []): boolean {
  return routeHasCapability(pathname, 'knowledgeFiles', surfaces);
}

export function routeSupportsContextRail(pathname: string, surfaces: ExtensionSurfaceSummary[] = []): boolean {
  return routeHasCapability(pathname, 'contextRail', surfaces);
}

export function routeSupportsWorkbench(pathname: string, surfaces: ExtensionSurfaceSummary[] = []): boolean {
  return routeHasCapability(pathname, 'workbench', surfaces);
}

export function routeSupportsWorkbenchFilePane(pathname: string, surfaces: ExtensionSurfaceSummary[] = []): boolean {
  return routeHasCapability(pathname, 'workbenchFilePane', surfaces);
}
