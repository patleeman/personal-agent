import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import type { ConversationAutomationWorkflowPreset, ConversationAutomationWorkspaceState } from '../types';
import { EmptyState, ErrorState, ListLinkRow, LoadingState, PageHeader, PageHeading, Pill, ToolbarButton } from '../components/ui';

const PRESET_ID_SEARCH_PARAM = 'preset';
const NEW_PRESET_SEARCH_PARAM = 'new';

function buildAutomationSearch(locationSearch: string, presetId: string | null, creatingNew = false): string {
  const params = new URLSearchParams(locationSearch);

  if (presetId) {
    params.set(PRESET_ID_SEARCH_PARAM, presetId);
  } else {
    params.delete(PRESET_ID_SEARCH_PARAM);
  }

  if (creatingNew) {
    params.set(NEW_PRESET_SEARCH_PARAM, '1');
  } else {
    params.delete(NEW_PRESET_SEARCH_PARAM);
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

function filterPresets(presets: ConversationAutomationWorkflowPreset[], query: string): ConversationAutomationWorkflowPreset[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return presets;
  }

  return presets.filter((preset) => {
    const haystack = [
      preset.name,
      ...preset.items.map((item) => `${item.label} ${item.skillName} ${item.skillArgs ?? ''}`),
    ].join('\n').toLowerCase();

    return haystack.includes(normalized);
  });
}

function presetMeta(preset: ConversationAutomationWorkflowPreset, workspace: ConversationAutomationWorkspaceState): string {
  const parts = [
    `${preset.items.length} ${preset.items.length === 1 ? 'item' : 'items'}`,
  ];

  if (workspace.presetLibrary.defaultPresetIds.includes(preset.id)) {
    parts.push('default');
  }

  return parts.join(' · ');
}

export function AutomationPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    data,
    loading,
    refreshing,
    error,
    refetch,
  } = useApi(api.conversationAutomationWorkspace);
  const [query, setQuery] = useState('');

  const selectedPresetId = useMemo(() => {
    const value = new URLSearchParams(location.search).get(PRESET_ID_SEARCH_PARAM);
    return value?.trim() || null;
  }, [location.search]);
  const creatingNew = useMemo(() => new URLSearchParams(location.search).get(NEW_PRESET_SEARCH_PARAM) === '1', [location.search]);
  const presets = data?.presetLibrary.presets ?? [];
  const filteredPresets = useMemo(() => filterPresets(presets, query), [presets, query]);
  const selectedPreset = useMemo(
    () => selectedPresetId ? presets.find((preset) => preset.id === selectedPresetId) ?? null : null,
    [presets, selectedPresetId],
  );

  const setSelection = useCallback((presetId: string | null, nextCreatingNew = false, replace = false) => {
    const nextSearch = buildAutomationSearch(location.search, presetId, nextCreatingNew);
    navigate(`/automation${nextSearch}`, { replace });
  }, [location.search, navigate]);

  useEffect(() => {
    if (loading || !selectedPresetId || !data) {
      return;
    }

    if (presets.some((preset) => preset.id === selectedPresetId)) {
      return;
    }

    setSelection(null, false, true);
  }, [data, loading, presets, selectedPresetId, setSelection]);

  const pageMeta = data
    ? [
      `${presets.length} ${presets.length === 1 ? 'preset' : 'presets'}`,
      data.presetLibrary.defaultPresetIds.length > 0
        ? `defaults ${data.presetLibrary.defaultPresetIds.map((presetId) => presets.find((preset) => preset.id === presetId)?.name ?? presetId).join(', ')}`
        : 'no default presets',
      `${data.skills.length} ${data.skills.length === 1 ? 'skill' : 'skills'} available`,
    ].join(' · ')
    : 'Reusable automation presets';

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        className="flex-wrap items-start gap-y-3"
        actions={(
          <>
            <ToolbarButton onClick={() => setSelection(null, true)}>
              + New preset
            </ToolbarButton>
            <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : '↻ Refresh'}
            </ToolbarButton>
          </>
        )}
      >
        <PageHeading title="Automation" meta={pageMeta} />
      </PageHeader>

      <div className="flex-1 px-6 py-4">
        {loading && <LoadingState label="Loading automation presets…" />}
        {error && <ErrorState message={`Unable to load automation presets: ${error}`} />}

        {!loading && !error && data && (
          <div className="space-y-5 pb-5">
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter presets by name or item"
                className="w-full max-w-xl rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60"
              />
            </div>

            {creatingNew && <p className="text-[12px] text-dim">Editing new preset in the right pane.</p>}

            {presets.length === 0 ? (
              <EmptyState
                title="No automation presets yet"
                body="Create a preset in the right pane."
                action={<ToolbarButton onClick={() => setSelection(null, true)}>Create preset</ToolbarButton>}
              />
            ) : filteredPresets.length === 0 ? (
              <EmptyState
                title="No presets match that filter"
                body="Try a different search term or clear the filter."
              />
            ) : (
              <div className="space-y-px">
                {filteredPresets.map((preset) => {
                  const selected = !creatingNew && preset.id === selectedPresetId;
                  return (
                    <ListLinkRow
                      key={preset.id}
                      to={`/automation${buildAutomationSearch(location.search, preset.id)}`}
                      selected={selected}
                      leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${data.presetLibrary.defaultPresetIds.includes(preset.id) ? 'bg-accent' : 'bg-teal'}`} />}
                      trailing={data.presetLibrary.defaultPresetIds.includes(preset.id) ? <Pill tone="accent">default</Pill> : undefined}
                    >
                      <p className="ui-row-title truncate">{preset.name}</p>
                      <p className="ui-row-summary">{presetMeta(preset, data)}</p>
                      <p className="ui-row-meta flex flex-wrap items-center gap-1.5">
                        <span>{preset.items.length} items</span>
                        <span className="opacity-40">·</span>
                        <span>{preset.updatedAt ? new Date(preset.updatedAt).toLocaleString() : 'saved in settings'}</span>
                      </p>
                    </ListLinkRow>
                  );
                })}
              </div>
            )}

            {selectedPreset && (
              <div className="rounded-xl border border-border-subtle bg-surface/70 px-4 py-3">
                <p className="ui-section-label">Selected preset</p>
                <p className="mt-1 text-[13px] font-medium text-primary">{selectedPreset.name}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
