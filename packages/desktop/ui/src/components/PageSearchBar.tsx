import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cx, IconButton, Keycap } from './ui';

const DESKTOP_SHORTCUT_EVENT = 'personal-agent-desktop-shortcut';
const PAGE_SEARCH_MATCH_HIGHLIGHT = 'pa-page-search-match';
const PAGE_SEARCH_ACTIVE_HIGHLIGHT = 'pa-page-search-active';
const NON_SEARCHABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SCRIPT', 'STYLE', 'NOSCRIPT']);

interface PageSearchProps {
  rootRef: RefObject<HTMLElement | null>;
  desktopShell?: boolean;
}

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

interface HighlightRegistry {
  set(name: string, value: unknown): void;
  delete(name: string): void;
}

interface HighlightInstance {
  add?(range: Range): unknown;
}

type HighlightConstructor = new (...ranges: Range[]) => HighlightInstance;

function normalizeWhitespaceForSearch(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function scheduleFrame(callback: FrameRequestCallback): number {
  if (typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }

  return window.setTimeout(() => {
    callback(Date.now());
  }, 0);
}

function cancelScheduledFrame(handle: number) {
  if (typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(handle);
    return;
  }

  window.clearTimeout(handle);
}

function isFindHotkey(event: KeyboardEvent): boolean {
  if (event.altKey || event.shiftKey) {
    return false;
  }

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return key === 'f' && (event.metaKey || event.ctrlKey);
}

function isFindNextHotkey(event: KeyboardEvent): boolean {
  if (event.altKey) {
    return false;
  }

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return key === 'g' && (event.metaKey || event.ctrlKey) && !event.shiftKey;
}

function isFindPreviousHotkey(event: KeyboardEvent): boolean {
  if (event.altKey) {
    return false;
  }

  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return key === 'g' && (event.metaKey || event.ctrlKey) && event.shiftKey;
}

function isDesktopPageSearchShortcutAction(value: unknown): value is 'find-in-page' {
  return value === 'find-in-page';
}

function readSelectedSearchText(): string {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') {
    return '';
  }

  const selection = window.getSelection();
  const text = selection?.toString().replace(/\s+/g, ' ').trim() ?? '';
  if (!text || text.length > 160) {
    return '';
  }

  return text;
}

function shouldSkipTextNode(node: Text): boolean {
  if ((node.nodeValue ?? '').length === 0) {
    return true;
  }

  const parent = node.parentElement;
  if (!parent) {
    return true;
  }

  if (NON_SEARCHABLE_TAGS.has(parent.tagName)) {
    return true;
  }

  if (parent.closest('[data-page-search-ignore="true"]')) {
    return true;
  }

  if (parent.closest('[hidden], [aria-hidden="true"], [inert]')) {
    return true;
  }

  const className = parent.className;
  if (typeof className === 'string') {
    const classes = new Set(className.split(/\s+/).filter(Boolean));
    if (classes.has('hidden') || classes.has('sr-only')) {
      return true;
    }
  }

  return false;
}

function collectTextSegments(root: HTMLElement): { rawText: string; segments: TextSegment[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node instanceof Text && !shouldSkipTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const segments: TextSegment[] = [];
  let rawText = '';
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) {
      const value = current.nodeValue ?? '';
      const start = rawText.length;
      rawText += value;
      segments.push({ node: current, start, end: start + value.length });
    }

    current = walker.nextNode();
  }

  return { rawText, segments };
}

function buildNormalizedIndex(rawText: string): { normalizedText: string; normalizedToRaw: number[] } {
  let normalizedText = '';
  const normalizedToRaw: number[] = [];
  let lastWasWhitespace = false;

  for (let index = 0; index < rawText.length; index += 1) {
    const character = rawText[index] ?? '';
    if (/\s/.test(character)) {
      if (!lastWasWhitespace) {
        normalizedText += ' ';
        normalizedToRaw.push(index);
        lastWasWhitespace = true;
      }
      continue;
    }

    normalizedText += character.toLocaleLowerCase();
    normalizedToRaw.push(index);
    lastWasWhitespace = false;
  }

  return { normalizedText, normalizedToRaw };
}

function findSegmentBoundary(segments: TextSegment[], rawIndex: number, mode: 'start' | 'end'): { node: Text; offset: number } | null {
  for (const segment of segments) {
    if (mode === 'start' ? rawIndex < segment.end : rawIndex <= segment.end) {
      return {
        node: segment.node,
        offset: Math.max(0, Math.min(rawIndex - segment.start, segment.end - segment.start)),
      };
    }
  }

  const fallback = segments[segments.length - 1];
  if (!fallback) {
    return null;
  }

  return {
    node: fallback.node,
    offset: fallback.end - fallback.start,
  };
}

export function findPageSearchRanges(root: HTMLElement, query: string): Range[] {
  const normalizedQuery = normalizeWhitespaceForSearch(query);
  if (!normalizedQuery) {
    return [];
  }

  const { rawText, segments } = collectTextSegments(root);
  if (!rawText || segments.length === 0) {
    return [];
  }

  const { normalizedText, normalizedToRaw } = buildNormalizedIndex(rawText);
  if (!normalizedText) {
    return [];
  }

  const ranges: Range[] = [];
  let searchFrom = 0;
  while (searchFrom <= normalizedText.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, searchFrom);
    if (matchIndex === -1) {
      break;
    }

    const rawStart = normalizedToRaw[matchIndex];
    const rawEnd =
      matchIndex + normalizedQuery.length < normalizedToRaw.length ? normalizedToRaw[matchIndex + normalizedQuery.length] : rawText.length;

    if (rawStart != null) {
      const startBoundary = findSegmentBoundary(segments, rawStart, 'start');
      const endBoundary = findSegmentBoundary(segments, rawEnd, 'end');
      if (startBoundary && endBoundary) {
        const range = document.createRange();
        range.setStart(startBoundary.node, startBoundary.offset);
        range.setEnd(endBoundary.node, endBoundary.offset);
        ranges.push(range);
      }
    }

    searchFrom = matchIndex + Math.max(1, normalizedQuery.length);
  }

  return ranges;
}

function getHighlightSupport(): { registry: HighlightRegistry; HighlightCtor: HighlightConstructor } | null {
  const scope = globalThis as typeof globalThis & {
    CSS?: { highlights?: HighlightRegistry };
    Highlight?: HighlightConstructor;
  };

  if (!scope.CSS?.highlights || !scope.Highlight) {
    return null;
  }

  return {
    registry: scope.CSS.highlights,
    HighlightCtor: scope.Highlight,
  };
}

function createHighlight(HighlightCtor: HighlightConstructor, ranges: Range[]): HighlightInstance {
  const highlight = new HighlightCtor();
  if (typeof highlight.add === 'function') {
    for (const range of ranges) {
      highlight.add(range);
    }
    return highlight;
  }

  return new HighlightCtor(...ranges);
}

function clearHighlights() {
  const support = getHighlightSupport();
  support?.registry.delete(PAGE_SEARCH_MATCH_HIGHLIGHT);
  support?.registry.delete(PAGE_SEARCH_ACTIVE_HIGHLIGHT);
}

function applyHighlights(ranges: Range[], activeIndex: number) {
  const support = getHighlightSupport();
  if (!support) {
    return;
  }

  support.registry.delete(PAGE_SEARCH_MATCH_HIGHLIGHT);
  support.registry.delete(PAGE_SEARCH_ACTIVE_HIGHLIGHT);

  if (ranges.length === 0) {
    return;
  }

  support.registry.set(PAGE_SEARCH_MATCH_HIGHLIGHT, createHighlight(support.HighlightCtor, ranges));
  const activeRange = ranges[activeIndex] ?? ranges[0];
  if (activeRange) {
    support.registry.set(PAGE_SEARCH_ACTIVE_HIGHLIGHT, createHighlight(support.HighlightCtor, [activeRange]));
  }
}

function scrollRangeIntoView(range: Range | undefined) {
  const target = range?.startContainer.parentElement;
  if (!target) {
    return;
  }

  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /mac|iphone|ipad|ipod/i.test(navigator.platform);
}

function ChevronIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {direction === 'up' ? <path d="m18 15-6-6-6 6" /> : <path d="m6 9 6 6 6-6" />}
    </svg>
  );
}

export function PageSearchBar({ rootRef, desktopShell = false }: PageSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Range[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [focusVersion, setFocusVersion] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const matchesCount = matches.length;
  const pendingScrollToMatchRef = useRef(false);
  const nextMatchModifierLabel = useMemo(() => (isMacPlatform() ? '⌘' : 'Ctrl'), []);
  const statusLabel = useMemo(() => {
    if (query.trim().length === 0) {
      return 'Type to search';
    }

    if (matchesCount === 0) {
      return 'No matches';
    }

    return `${activeIndex + 1}/${matchesCount}`;
  }, [activeIndex, matchesCount, query]);

  const focusInput = useCallback(() => {
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, []);

  const openSearch = useCallback(() => {
    const selectedText = readSelectedSearchText();
    setOpen(true);
    pendingScrollToMatchRef.current = true;
    setQuery((current) => (current.trim().length > 0 || open ? current : selectedText));
    if (!open) {
      setActiveIndex(0);
    }
    setFocusVersion((current) => current + 1);
  }, [open]);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setMatches([]);
    setActiveIndex(0);
    clearHighlights();
  }, []);

  const moveToMatch = useCallback(
    (delta: number) => {
      if (matchesCount === 0) {
        return;
      }

      pendingScrollToMatchRef.current = true;
      setActiveIndex((current) => {
        const nextIndex = (current + delta + matchesCount) % matchesCount;
        return nextIndex;
      });
    },
    [matchesCount],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      if (isFindHotkey(event)) {
        event.preventDefault();
        openSearch();
        return;
      }

      if (!open) {
        return;
      }

      if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        closeSearch();
        return;
      }

      if (isFindNextHotkey(event)) {
        event.preventDefault();
        moveToMatch(1);
        return;
      }

      if (isFindPreviousHotkey(event)) {
        event.preventDefault();
        moveToMatch(-1);
      }
    }

    function handleDesktopShortcut(event: Event) {
      const action = (event as CustomEvent<{ action?: unknown }>).detail?.action;
      if (!isDesktopPageSearchShortcutAction(action)) {
        return;
      }

      openSearch();
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener(DESKTOP_SHORTCUT_EVENT, handleDesktopShortcut);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener(DESKTOP_SHORTCUT_EVENT, handleDesktopShortcut);
    };
  }, [closeSearch, moveToMatch, open, openSearch]);

  useEffect(() => {
    if (!open) {
      clearHighlights();
      return;
    }

    focusInput();
  }, [focusInput, focusVersion, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const root = rootRef.current;
    if (!root) {
      setMatches([]);
      return;
    }

    const normalizedQuery = normalizeWhitespaceForSearch(query);
    if (!normalizedQuery) {
      setMatches([]);
      return;
    }

    let frame = 0;
    const refreshMatches = () => {
      if (frame) {
        cancelScheduledFrame(frame);
      }

      frame = scheduleFrame(() => {
        const nextMatches = findPageSearchRanges(root, query);
        setMatches(nextMatches);
        setActiveIndex((current) => {
          if (nextMatches.length === 0) {
            return 0;
          }

          return Math.min(current, nextMatches.length - 1);
        });
      });
    };

    refreshMatches();

    const observer = new MutationObserver(() => {
      refreshMatches();
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    return () => {
      observer.disconnect();
      if (frame) {
        cancelScheduledFrame(frame);
      }
    };
  }, [open, query, rootRef]);

  useEffect(() => {
    if (!open) {
      clearHighlights();
      return;
    }

    applyHighlights(matches, activeIndex);

    return () => {
      clearHighlights();
    };
  }, [activeIndex, matches, open]);

  useEffect(() => {
    if (!open || !pendingScrollToMatchRef.current || matches.length === 0) {
      return;
    }

    pendingScrollToMatchRef.current = false;
    scrollRangeIntoView(matches[activeIndex]);
  }, [activeIndex, matches, open]);

  if (!open) {
    return null;
  }

  const topClassName = desktopShell ? 'top-12' : 'top-4';

  return (
    <div className={cx('pointer-events-none fixed right-4 z-40', topClassName)} data-page-search-ignore="true">
      <div className="pointer-events-auto ui-context-menu-shell flex min-w-[19rem] items-center gap-2 px-2.5 py-2 shadow-2xl">
        <label
          className="ui-input-shell flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 focus-within:border-accent/50 focus-within:bg-base/90"
          aria-label="Page search"
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-dim"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              pendingScrollToMatchRef.current = true;
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeSearch();
                return;
              }

              if (event.key === 'Enter') {
                event.preventDefault();
                moveToMatch(event.shiftKey ? -1 : 1);
              }
            }}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-primary outline-none placeholder:text-dim/70"
            placeholder="Find on page…"
            aria-label="Find on page"
            autoComplete="off"
            name="page-search"
            spellCheck={false}
          />
        </label>

        <div className="min-w-[4.25rem] text-right text-[11px] font-medium tabular-nums text-dim" aria-live="polite">
          {statusLabel}
        </div>

        <div className="flex items-center gap-0.5">
          <IconButton
            type="button"
            onClick={() => moveToMatch(-1)}
            disabled={matchesCount === 0}
            aria-label="Previous match"
            title="Previous match (Shift+Enter)"
            className="h-7 w-7 rounded-md"
          >
            <ChevronIcon direction="up" />
          </IconButton>
          <IconButton
            type="button"
            onClick={() => moveToMatch(1)}
            disabled={matchesCount === 0}
            aria-label="Next match"
            title="Next match (Enter)"
            className="h-7 w-7 rounded-md"
          >
            <ChevronIcon direction="down" />
          </IconButton>
        </div>

        <div className="hidden items-center gap-1 pl-1 text-[10px] text-dim md:flex">
          <Keycap>{nextMatchModifierLabel}</Keycap>
          <Keycap>G</Keycap>
        </div>

        <IconButton type="button" onClick={closeSearch} aria-label="Close page search" title="Close" className="h-7 w-7 rounded-md">
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}
