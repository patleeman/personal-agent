export interface SystemExtensionPageSurface {
  extensionId: string;
  surfaceId: string;
  route: string;
  component: 'automations';
}

export const SYSTEM_EXTENSION_PAGE_SURFACES: SystemExtensionPageSurface[] = [
  {
    extensionId: 'system-automations',
    surfaceId: 'page',
    route: '/automations',
    component: 'automations',
  },
];

export function findSystemExtensionPage(pathname: string): SystemExtensionPageSurface | null {
  return SYSTEM_EXTENSION_PAGE_SURFACES.find((surface) => pathname === surface.route || pathname.startsWith(`${surface.route}/`)) ?? null;
}
