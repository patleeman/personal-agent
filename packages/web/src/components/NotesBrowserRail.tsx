import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, ToolbarButton } from './ui';
import {
  buildNoteListMeta,
  buildNoteSearch,
  filterMemories,
  NOTE_ID_SEARCH_PARAM,
  NOTE_ITEM_SEARCH_PARAM,
  noteKindLabel,
  readCreateState,
  readNoteView,
} from '../noteWorkspaceState';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

function noteDotClass(status: string | undefined, usedInLastSession: boolean | undefined): string {
  const normalizedStatus = status?.trim().toLowerCase();
  if (normalizedStatus === 'archived') {
    return 'bg-border-default';
  }
  if (normalizedStatus === 'draft') {
    return 'bg-warning';
  }
  return usedInLastSession ? 'bg-accent' : 'bg-teal';
}

export function NotesBrowserRail() {
  const location = useLocation();
  const { data, loading, error, refreshing, refetch } = useApi(api.notes);
  const [query, setQuery] = useState('');
  const memories = data?.memories ?? [];
  const filteredMemories = useMemo(() => filterMemories(memories, query), [memories, query]);
  const selectedMemoryId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get(NOTE_ID_SEARCH_PARAM)?.trim() || params.get('memory')?.trim() || null;
  }, [location.search]);
  const selectedView = useMemo(() => readNoteView(location.search), [location.search]);
  const selectedItem = useMemo(() => new URLSearchParams(location.search).get(NOTE_ITEM_SEARCH_PARAM)?.trim() || null, [location.search]);
  const creating = useMemo(() => readCreateState(location.search), [location.search]);
  const selectedMemory = memories.find((memory) => memory.id === selectedMemoryId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-border-subtle px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="ui-card-title">Notes</p>
            <p className="ui-card-meta mt-1">Browse notes and open them in the main workspace.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link to={`/notes${buildNoteSearch(location.search, { creating: true, view: 'main', item: null })}`} className="ui-toolbar-button text-accent">
              New
            </Link>
            <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : '↻'}
            </ToolbarButton>
          </div>
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search notes"
          className={INPUT_CLASS}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="ui-card-meta">
          {query.trim() ? `Showing ${filteredMemories.length} of ${memories.length}.` : `${memories.length} notes.`}
          {creating ? ' Creating a new note.' : selectedMemoryId ? ` Selected @${selectedMemoryId}.` : ''}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading && !data ? <LoadingState label="Loading notes…" className="px-0 py-0" /> : null}
        {error && !data ? <ErrorState message={`Unable to load notes: ${error}`} className="px-0 py-0" /> : null}

        {!loading && !error && filteredMemories.length === 0 ? (
          <EmptyState
            className="py-8"
            title={memories.length === 0 ? 'No notes yet' : 'No matches'}
            body={memories.length === 0 ? 'Create a note to start building durable context.' : 'Try a broader search across titles, summaries, and tags.'}
          />
        ) : null}

        {!loading && !error && filteredMemories.length > 0 && (
          <div className="space-y-px">
            {filteredMemories.map((memory) => (
              <ListLinkRow
                key={memory.id}
                to={`/notes${buildNoteSearch(location.search, { memoryId: memory.id, view: 'main', item: null, creating: false })}`}
                selected={memory.id === selectedMemoryId && !creating}
                leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${noteDotClass(memory.status, memory.usedInLastSession)}`} />}
              >
                <p className="ui-row-title">{memory.title}</p>
                <p className="ui-row-summary">{memory.summary || 'No summary yet.'}</p>
                <div className="ui-row-meta flex flex-wrap items-center gap-1.5">
                  <span>{buildNoteListMeta(memory)}</span>
                </div>
              </ListLinkRow>
            ))}
          </div>
        )}

        {selectedMemory && !creating && (
          <div className="space-y-2 border-t border-border-subtle pt-4">
            <p className="ui-section-label">Resources</p>
            <div className="space-y-px">
              <ListLinkRow
                to={`/notes${buildNoteSearch(location.search, { memoryId: selectedMemory.id, view: 'main', item: null, creating: false })}`}
                selected={selectedView === 'main'}
              >
                <p className="ui-row-title">Main</p>
                <p className="ui-row-summary">Primary note document</p>
                <p className="ui-row-meta">{noteKindLabel(selectedMemory)}</p>
              </ListLinkRow>
              <ListLinkRow
                to={`/notes${buildNoteSearch(location.search, { memoryId: selectedMemory.id, view: 'references', item: selectedItem, creating: false })}`}
                selected={selectedView === 'references'}
              >
                <p className="ui-row-title">References</p>
                <p className="ui-row-summary">Supporting documents and research</p>
                <p className="ui-row-meta">{selectedMemory.referenceCount ?? 0} files</p>
              </ListLinkRow>
              <ListLinkRow
                to={`/notes${buildNoteSearch(location.search, { memoryId: selectedMemory.id, view: 'links', item: null, creating: false })}`}
                selected={selectedView === 'links'}
              >
                <p className="ui-row-title">Links</p>
                <p className="ui-row-summary">Relationships with other nodes</p>
                <p className="ui-row-meta">Open node graph details</p>
              </ListLinkRow>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
