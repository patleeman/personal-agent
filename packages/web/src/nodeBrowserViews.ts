export const NODE_BROWSER_SAVED_VIEWS_STORAGE_KEY = 'pa:nodes:saved-views';

export interface SavedNodeBrowserView {
  id: string;
  name: string;
  search: string;
  createdAt: string;
  updatedAt: string;
}

function normalizeView(input: Partial<SavedNodeBrowserView>): SavedNodeBrowserView | null {
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const search = typeof input.search === 'string' ? input.search.trim() : '';
  const createdAt = typeof input.createdAt === 'string' ? input.createdAt.trim() : '';
  const updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt.trim() : '';
  if (!id || !name) {
    return null;
  }

  const timestamp = new Date().toISOString();
  return {
    id,
    name,
    search,
    createdAt: createdAt || timestamp,
    updatedAt: updatedAt || timestamp,
  };
}

export function readSavedNodeBrowserViews(): SavedNodeBrowserView[] {
  try {
    const raw = localStorage.getItem(NODE_BROWSER_SAVED_VIEWS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => normalizeView(entry as Partial<SavedNodeBrowserView>))
      .filter((entry): entry is SavedNodeBrowserView => entry !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

function writeSavedNodeBrowserViews(views: SavedNodeBrowserView[]): void {
  try {
    if (views.length === 0) {
      localStorage.removeItem(NODE_BROWSER_SAVED_VIEWS_STORAGE_KEY);
      return;
    }
    localStorage.setItem(NODE_BROWSER_SAVED_VIEWS_STORAGE_KEY, JSON.stringify(views));
  } catch {
    // Ignore storage failures.
  }
}

function slugifyViewName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'view';
}

export function saveNodeBrowserView(name: string, search: string): SavedNodeBrowserView[] {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return readSavedNodeBrowserViews();
  }

  const existing = readSavedNodeBrowserViews();
  const now = new Date().toISOString();
  const existingByName = existing.find((view) => view.name.toLowerCase() === trimmedName.toLowerCase());
  const next = existingByName
    ? existing.map((view) => view.id === existingByName.id ? { ...view, name: trimmedName, search, updatedAt: now } : view)
    : [...existing, {
      id: `${slugifyViewName(trimmedName)}-${Date.now()}`,
      name: trimmedName,
      search,
      createdAt: now,
      updatedAt: now,
    }];
  writeSavedNodeBrowserViews(next);
  return readSavedNodeBrowserViews();
}

export function deleteSavedNodeBrowserView(viewId: string): SavedNodeBrowserView[] {
  const next = readSavedNodeBrowserViews().filter((view) => view.id !== viewId);
  writeSavedNodeBrowserViews(next);
  return next;
}
