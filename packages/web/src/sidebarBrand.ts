export const DEFAULT_SIDEBAR_BRAND_LABEL = 'personal agent';

export function getSidebarBrandLabel(activeProfile?: string | null): string {
  const normalized = activeProfile?.trim();
  return normalized && normalized.length > 0
    ? normalized
    : DEFAULT_SIDEBAR_BRAND_LABEL;
}
