/**
 * Shared React contexts for cross-component state.
 */
import { createContext, useContext } from 'react';

// ── Live title overrides ──────────────────────────────────────────────────────
// ConversationPage pushes stream.title here; Sidebar reads it to update tabs/shelf.

export interface LiveTitlesContextValue {
  titles: Map<string, string>;
  setTitle: (id: string, title: string) => void;
}

export const LiveTitlesContext = createContext<LiveTitlesContextValue>({
  titles: new Map(),
  setTitle: () => {},
});

export function useLiveTitles() {
  return useContext(LiveTitlesContext);
}
