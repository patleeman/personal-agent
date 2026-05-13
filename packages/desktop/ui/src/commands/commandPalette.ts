import { fuzzyScore } from './slashMenu';

export type CommandPaletteSection = string;
export type CommandPaletteScope = string;

export const THREADS_COMMAND_PALETTE_SCOPE = 'threads';

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

interface CommandPaletteResultItem<TAction = unknown> extends CommandPaletteItem<TAction> {
  score: number;
}

interface CommandPaletteSectionResult<TAction = unknown> {
  section: CommandPaletteSection;
  label: string;
  items: CommandPaletteResultItem<TAction>[];
  total: number;
}

export const THREAD_COMMAND_PALETTE_SECTIONS: CommandPaletteSection[] = ['open', 'archived'];

export const COMMAND_PALETTE_SECTION_LABELS: Record<CommandPaletteSection, string> = {
  open: 'Open threads',
  archived: 'Archived threads',
};

export const COMMAND_PALETTE_SCOPE_OPTIONS: Array<{ value: CommandPaletteScope; label: string }> = [
  { value: THREADS_COMMAND_PALETTE_SCOPE, label: 'Threads' },
];

export function shouldBootstrapCommandPaletteThreads(options: {
  open: boolean;
  scope: CommandPaletteScope;
  sessions: unknown[] | null;
  alreadyRequested: boolean;
}): boolean {
  if (!options.open || options.sessions !== null || options.alreadyRequested) {
    return false;
  }

  return options.scope === THREADS_COMMAND_PALETTE_SCOPE;
}

export function isCommandPaletteThreadDataLoading(options: { sessions: unknown[] | null; sessionsLoading: boolean }): boolean {
  return options.sessions === null || options.sessionsLoading;
}

function dedupeCommandPaletteItems<TAction>(items: CommandPaletteItem<TAction>[]): CommandPaletteItem<TAction>[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }

    seen.add(item.id);
    return true;
  });
}

export function selectCommandPaletteScopedItems<TAction>(input: {
  scope: CommandPaletteScope;
  query: string;
  openConversationItems: CommandPaletteItem<TAction>[];
  archivedConversationItems: CommandPaletteItem<TAction>[];
  fileItems: CommandPaletteItem<TAction>[];
  searchedConversationItems: CommandPaletteItem<TAction>[];
  searchedFileItems: CommandPaletteItem<TAction>[];
}): CommandPaletteItem<TAction>[] {
  const hasQuery = input.query.trim().length > 0;
  const conversationItems = [
    ...input.openConversationItems,
    ...input.archivedConversationItems,
    ...(hasQuery ? input.searchedConversationItems : []),
  ];
  const fileItems = [...input.fileItems, ...(hasQuery ? input.searchedFileItems : [])];

  switch (input.scope) {
    case THREADS_COMMAND_PALETTE_SCOPE:
      return dedupeCommandPaletteItems(conversationItems);
    default:
      return dedupeCommandPaletteItems(fileItems.filter((item) => item.section === input.scope));
  }
}

const EMPTY_QUERY_LIMITS: Record<string, number> = {
  open: 12,
  archived: 8,
};
const DEFAULT_QUICK_OPEN_EMPTY_QUERY_LIMIT = 30;
const MAX_EMPTY_QUERY_LIMIT = 100;

function readEmptyQueryLimit(section: CommandPaletteSection, value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? Math.min(MAX_EMPTY_QUERY_LIMIT, value)
    : (EMPTY_QUERY_LIMITS[section] ?? DEFAULT_QUICK_OPEN_EMPTY_QUERY_LIMIT);
}

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

function scoreCommandPaletteItem<TAction>(item: CommandPaletteItem<TAction>, query: string): number | null {
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
  options: {
    query: string;
    scope: CommandPaletteScope;
    scopeSections?: CommandPaletteSection[];
    sectionLabels?: Partial<Record<CommandPaletteSection, string>>;
    emptyQueryLimits?: Partial<Record<CommandPaletteSection, number>>;
  },
): CommandPaletteSectionResult<TAction>[] {
  const query = options.query.trim();
  const emptyQuery = query.length === 0;
  const visibleSections =
    options.scopeSections ?? (options.scope === THREADS_COMMAND_PALETTE_SCOPE ? THREAD_COMMAND_PALETTE_SECTIONS : [options.scope]);

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

    const emptyQueryLimit = readEmptyQueryLimit(section, options.emptyQueryLimits?.[section]);
    const limited = emptyQuery ? rankedItems.slice(0, emptyQueryLimit) : rankedItems;

    return [
      {
        section,
        label: options.sectionLabels?.[section] ?? COMMAND_PALETTE_SECTION_LABELS[section] ?? section,
        total: rankedItems.length,
        items: limited.map(({ item, score }) => ({ ...item, score })),
      } satisfies CommandPaletteSectionResult<TAction>,
    ];
  });
}
