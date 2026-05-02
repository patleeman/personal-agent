import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildInlineRunExpansionKey } from './linkedRunPolling.js';
import { collectTraceClusterLinkedRuns } from './linkedRuns.js';
import type { ChatRenderItem } from './transcriptItems.js';

export function collectVisibleInlineRunKeys(renderItems: ChatRenderItem[]): Set<string> {
  const next = new Set<string>();

  for (const item of renderItems) {
    if (item.type !== 'trace_cluster') {
      continue;
    }

    for (const run of collectTraceClusterLinkedRuns(item.blocks)) {
      next.add(buildInlineRunExpansionKey(item.startIndex, run.runId));
    }
  }

  return next;
}

export function filterInlineRunKeys(current: ReadonlySet<string>, visibleInlineRunKeySet: ReadonlySet<string>): ReadonlySet<string> {
  if (current.size === 0) {
    return current;
  }

  let changed = false;
  const next = new Set<string>();
  for (const inlineRunKey of current) {
    if (visibleInlineRunKeySet.has(inlineRunKey)) {
      next.add(inlineRunKey);
    } else {
      changed = true;
    }
  }

  return changed ? next : current;
}

export function toggleInlineRunKey(current: ReadonlySet<string>, inlineRunKey: string): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(inlineRunKey)) {
    next.delete(inlineRunKey);
  } else {
    next.add(inlineRunKey);
  }
  return next;
}

export function useInlineTraceRunExpansion(renderItems: ChatRenderItem[]) {
  const [expandedInlineRunKeys, setExpandedInlineRunKeys] = useState<ReadonlySet<string>>(() => new Set());
  const visibleInlineRunKeySet = useMemo(() => collectVisibleInlineRunKeys(renderItems), [renderItems]);

  useEffect(() => {
    setExpandedInlineRunKeys((current) => filterInlineRunKeys(current, visibleInlineRunKeySet));
  }, [visibleInlineRunKeySet]);

  const isInlineRunExpanded = useCallback((inlineRunKey: string) => expandedInlineRunKeys.has(inlineRunKey), [expandedInlineRunKeys]);

  const toggleInlineRun = useCallback((inlineRunKey: string) => {
    setExpandedInlineRunKeys((current) => toggleInlineRunKey(current, inlineRunKey));
  }, []);

  return {
    isInlineRunExpanded,
    toggleInlineRun,
  };
}
