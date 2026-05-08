type AppRouteCapability = 'contextRail' | 'workbench' | 'workbenchFilePane' | 'knowledgeFiles' | 'settingsSection';

interface AppRoutePattern {
  id: string;
  prefix: string;
  capabilities: AppRouteCapability[];
}

const CORE_ROUTE_PATTERNS: AppRoutePattern[] = [
  { id: 'conversations', prefix: '/conversations', capabilities: ['contextRail', 'workbench', 'workbenchFilePane'] },
  { id: 'automations', prefix: '/automations', capabilities: ['contextRail', 'workbench', 'workbenchFilePane'] },
  { id: 'extensions', prefix: '/extensions', capabilities: ['contextRail'] },
  { id: 'gateways', prefix: '/gateways', capabilities: ['contextRail'] },
  { id: 'knowledge', prefix: '/knowledge', capabilities: ['contextRail', 'knowledgeFiles'] },
  { id: 'telemetry', prefix: '/telemetry', capabilities: ['contextRail'] },
  { id: 'settings', prefix: '/settings', capabilities: ['settingsSection'] },
];

export function routeMatchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function routeHasCapability(pathname: string, capability: AppRouteCapability): boolean {
  return CORE_ROUTE_PATTERNS.some((route) => route.capabilities.includes(capability) && routeMatchesPrefix(pathname, route.prefix));
}

export function routeIsKnowledge(pathname: string): boolean {
  return routeHasCapability(pathname, 'knowledgeFiles');
}

export function routeSupportsContextRail(pathname: string): boolean {
  return routeHasCapability(pathname, 'contextRail');
}

export function routeSupportsWorkbench(pathname: string): boolean {
  return routeHasCapability(pathname, 'workbench');
}

export function routeSupportsWorkbenchFilePane(pathname: string): boolean {
  return routeHasCapability(pathname, 'workbenchFilePane');
}
