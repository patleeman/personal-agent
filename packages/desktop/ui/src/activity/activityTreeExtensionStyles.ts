import { api } from '../client/api';
import type { ExtensionActivityTreeItemStyleRegistration } from '../extensions/useExtensionRegistry';
import type { ActivityTreeItem } from './activityTree';

interface ActivityTreeStyleProviderResult {
  accentColor?: string;
  backgroundColor?: string;
  titlePrefix?: string;
  titleSuffix?: string;
  tooltip?: string;
}

export async function applyActivityTreeItemStyleProviders(
  items: readonly ActivityTreeItem[],
  providers: readonly ExtensionActivityTreeItemStyleRegistration[],
): Promise<ActivityTreeItem[]> {
  if (providers.length === 0 || items.length === 0) return [...items];

  const styledItems = items.map((item) => ({ ...item }));

  await Promise.all(
    providers.map(async (provider) => {
      try {
        const response = await api.invokeExtensionAction(provider.extensionId, provider.provider, { items: styledItems });
        const stylesById = normalizeStyleProviderResponse(response.result);
        for (const item of styledItems) {
          const style = stylesById.get(item.id);
          if (!style) continue;
          if (style.accentColor !== undefined && item.accentColor === undefined) item.accentColor = style.accentColor;
          if (style.backgroundColor !== undefined && item.backgroundColor === undefined) item.backgroundColor = style.backgroundColor;
          if (style.titlePrefix) item.title = `${style.titlePrefix}${item.title}`;
          if (style.titleSuffix) item.title = `${item.title}${style.titleSuffix}`;
          if (style.tooltip) item.metadata = { ...item.metadata, tooltip: style.tooltip };
        }
      } catch {
        // Extension style providers are optional decoration. A broken provider should not break the sidebar.
      }
    }),
  );

  return styledItems;
}

function normalizeStyleProviderResponse(value: unknown): Map<string, ActivityTreeStyleProviderResult> {
  const styles = new Map<string, ActivityTreeStyleProviderResult>();
  const entries = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.items)
      ? value.items
      : isRecord(value) && isRecord(value.stylesById)
        ? Object.entries(value.stylesById).map(([id, style]) => ({ id, ...(isRecord(style) ? style : {}) }))
        : [];

  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    const style: ActivityTreeStyleProviderResult = {};
    if (typeof entry.accentColor === 'string') style.accentColor = entry.accentColor;
    if (typeof entry.backgroundColor === 'string') style.backgroundColor = entry.backgroundColor;
    if (typeof entry.titlePrefix === 'string') style.titlePrefix = entry.titlePrefix;
    if (typeof entry.titleSuffix === 'string') style.titleSuffix = entry.titleSuffix;
    if (typeof entry.tooltip === 'string') style.tooltip = entry.tooltip;
    styles.set(entry.id, style);
  }

  return styles;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
