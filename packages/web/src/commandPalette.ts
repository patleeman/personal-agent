import { fuzzyScore } from './slashMenu';

export type CommandPaletteSection = 'nav' | 'open' | 'archived' | 'memories' | 'tasks' | 'projects';
export type CommandPaletteScope = 'all' | CommandPaletteSection;

export interface CommandPaletteItem<TAction = unknown> {
  id: string;
  section: CommandPaletteSection;
  title: string;
  subtitle?: string;
  meta?: string;
  keywords?: string[];
  order?: number;
  disabled?: boolean;
  action: TAction;
}

export interface CommandPaletteResultItem<TAction = unknown> extends CommandPaletteItem<TAction> {
  score: number;
}

export interface CommandPaletteSectionResult<TAction = unknown> {
  section: CommandPaletteSection;
  label: string;
  items: CommandPaletteResultItem<TAction>[];
  total: number;
}

export const COMMAND_PALETTE_SECTION_ORDER: CommandPaletteSection[] = [
  'nav',
  'open',
  'archived',
  'memories',
  'tasks',
  'projects',
];

export const COMMAND_PALETTE_SECTION_LABELS: Record<CommandPaletteSection, string> = {
  nav: 'Navigation',
  open: 'Open conversations',
  archived: 'Archived conversations',
  memories: 'Memories',
  tasks: 'Scheduled tasks',
  projects: 'Projects',
};

export const COMMAND_PALETTE_SCOPE_OPTIONS: Array<{ value: CommandPaletteScope; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'nav', label: 'Navigation' },
  { value: 'open', label: 'Open' },
  { value: 'archived', label: 'Archived' },
  { value: 'memories', label: 'Memories' },
  { value: 'tasks', label: 'Scheduled' },
  { value: 'projects', label: 'Projects' },
];

const EMPTY_QUERY_LIMITS: Record<CommandPaletteSection, number> = {
  nav: 12,
  open: 12,
  archived: 8,
  memories: 8,
  tasks: 8,
  projects: 8,
};

function tokenizeQuery(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function scoreField(token: string, value: string | undefined, weight: number): number | null {
  if (!value) {
    return null;
  }

  const normalizedValue = value.toLowerCase();
  const containsIndex = normalizedValue.indexOf(token);
  if (containsIndex !== -1) {
    return weight + Math.max(0, 32 - containsIndex) + Math.max(0, 20 - (normalizedValue.length - token.length));
  }

  const fuzzy = fuzzyScore(token, value);
  if (fuzzy === null) {
    return null;
  }

  return Math.floor(weight / 3) + fuzzy;
}

export function scoreCommandPaletteItem<TAction>(item: CommandPaletteItem<TAction>, query: string): number | null {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return 0;
  }

  let total = 0;
  const keywordFields = item.keywords ?? [];

  for (const token of tokens) {
    let bestTokenScore: number | null = null;

    const titleScore = scoreField(token, item.title, 110);
    if (titleScore !== null) {
      bestTokenScore = Math.max(bestTokenScore ?? titleScore, titleScore);
    }

    const subtitleScore = scoreField(token, item.subtitle, 70);
    if (subtitleScore !== null) {
      bestTokenScore = Math.max(bestTokenScore ?? subtitleScore, subtitleScore);
    }

    const metaScore = scoreField(token, item.meta, 55);
    if (metaScore !== null) {
      bestTokenScore = Math.max(bestTokenScore ?? metaScore, metaScore);
    }

    for (const keyword of keywordFields) {
      const keywordScore = scoreField(token, keyword, 85);
      if (keywordScore !== null) {
        bestTokenScore = Math.max(bestTokenScore ?? keywordScore, keywordScore);
      }
    }

    if (bestTokenScore === null) {
      return null;
    }

    total += bestTokenScore;
  }

  return total;
}

function compareByDefaultOrder<TAction>(left: CommandPaletteItem<TAction>, right: CommandPaletteItem<TAction>): number {
  const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return left.title.localeCompare(right.title);
}

export function searchCommandPaletteItems<TAction>(
  items: CommandPaletteItem<TAction>[],
  options: { query: string; scope: CommandPaletteScope },
): CommandPaletteSectionResult<TAction>[] {
  const query = options.query.trim();
  const emptyQuery = query.length === 0;
  const visibleSections = options.scope === 'all'
    ? COMMAND_PALETTE_SECTION_ORDER
    : COMMAND_PALETTE_SECTION_ORDER.filter((section) => section === options.scope);

  return visibleSections.flatMap((section) => {
    const sectionItems = items.filter((item) => item.section === section);
    const rankedItems = sectionItems
      .map((item) => ({ item, score: scoreCommandPaletteItem(item, query) }))
      .filter((entry): entry is { item: CommandPaletteItem<TAction>; score: number } => entry.score !== null)
      .sort((left, right) => {
        if (!emptyQuery && left.score !== right.score) {
          return right.score - left.score;
        }

        return compareByDefaultOrder(left.item, right.item);
      });

    if (rankedItems.length === 0) {
      return [];
    }

    const limited = emptyQuery && options.scope === 'all'
      ? rankedItems.slice(0, EMPTY_QUERY_LIMITS[section])
      : rankedItems;

    return [{
      section,
      label: COMMAND_PALETTE_SECTION_LABELS[section],
      total: rankedItems.length,
      items: limited.map(({ item, score }) => ({ ...item, score })),
    } satisfies CommandPaletteSectionResult<TAction>];
  });
}
