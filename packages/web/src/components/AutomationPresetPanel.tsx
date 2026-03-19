import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import {
  appendChecklistPresetItems,
  checklistDraftItemsToTemplateItems,
  cloneChecklistDraftItems,
  createChecklistDraftItem,
  type ChecklistDraftItem,
  summarizeChecklistText,
  toChecklistDraftItems,
} from '../checklists';
import { useApi } from '../hooks';
import type { ConversationAutomationWorkflowPreset } from '../types';
import { ErrorState, ListButtonRow, LoadingState, Pill, ToolbarButton, cx } from './ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[88px] resize-y leading-relaxed`;

function createDraftId(prefix: 'preset'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildAutomationSearch(locationSearch: string, presetId: string | null, creatingNew = false): string {
  const params = new URLSearchParams(locationSearch);

  if (presetId) {
    params.set('plan', presetId);
  } else {
    params.delete('plan');
  }

  if (creatingNew) {
    params.set('new', '1');
  } else {
    params.delete('new');
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

function clonePreset(preset: ConversationAutomationWorkflowPreset): ConversationAutomationWorkflowPreset {
  return {
    id: preset.id,
    name: preset.name,
    updatedAt: preset.updatedAt,
    items: preset.items.map((item) => ({ ...item })),
  };
}

function moveDraftItem(items: ChecklistDraftItem[], itemId: string, targetItemId: string): ChecklistDraftItem[] {
  if (itemId === targetItemId) {
    return items;
  }

  const sourceIndex = items.findIndex((item) => item.id === itemId);
  const targetIndex = items.findIndex((item) => item.id === targetItemId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) {
    return items;
  }
  next.splice(targetIndex, 0, moved);
  return next;
}

function checklistSearchText(preset: ConversationAutomationWorkflowPreset): string {
  return [preset.name, ...toChecklistDraftItems(preset.items).map((item) => item.text)].join('\n').toLowerCase();
}

export function AutomationPresetPanel({
  presetId,
  creatingNew,
}: {
  presetId: string | null;
  creatingNew: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    data,
    loading,
    error,
    refetch,
  } = useApi(api.conversationPlansWorkspace);
  const [initializedKey, setInitializedKey] = useState<string | null>(null);
  const [presetNameDraft, setPresetNameDraft] = useState('');
  const [draftItems, setDraftItems] = useState<ChecklistDraftItem[]>([]);
  const [appendOpen, setAppendOpen] = useState(false);
  const [appendQuery, setAppendQuery] = useState('');
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'save' | 'delete' | 'default' | null>(null);

  const selectedPreset = useMemo(
    () => presetId && data ? data.presetLibrary.presets.find((preset) => preset.id === presetId) ?? null : null,
    [data, presetId],
  );
  const panelKey = creatingNew ? 'new' : selectedPreset?.id ?? null;
  const baseline = useMemo(() => JSON.stringify({
    name: selectedPreset?.name ?? '',
    items: toChecklistDraftItems(selectedPreset?.items ?? []),
  }), [selectedPreset]);
  const editorDirty = JSON.stringify({ name: presetNameDraft, items: draftItems }) !== baseline;
  const visibleAppendPresets = useMemo(() => {
    const normalized = appendQuery.trim().toLowerCase();
    return (data?.presetLibrary.presets ?? [])
      .filter((preset) => preset.id !== selectedPreset?.id)
      .filter((preset) => !normalized || checklistSearchText(preset).includes(normalized));
  }, [appendQuery, data?.presetLibrary.presets, selectedPreset?.id]);

  useEffect(() => {
    if (!data || !panelKey || initializedKey === panelKey) {
      return;
    }

    setPresetNameDraft(creatingNew ? 'New checklist' : (selectedPreset?.name ?? ''));
    setDraftItems(creatingNew ? [] : toChecklistDraftItems(selectedPreset?.items ?? []));
    setAppendOpen(false);
    setAppendQuery('');
    setActionError(null);
    setPendingAction(null);
    setInitializedKey(panelKey);
  }, [creatingNew, data, initializedKey, panelKey, selectedPreset]);

  async function savePresets(nextPresets: ConversationAutomationWorkflowPreset[], nextDefaultPresetIds: string[]) {
    await api.updateConversationPlanLibrary({
      presets: nextPresets,
      defaultPresetIds: nextDefaultPresetIds,
    });
    await refetch({ resetLoading: false });
  }

  async function handleSave() {
    if (!data || pendingAction || !presetNameDraft.trim()) {
      return;
    }

    const normalizedItems = checklistDraftItemsToTemplateItems(draftItems);
    if (normalizedItems.length === 0) {
      setActionError('Add at least one item.');
      return;
    }

    setActionError(null);
    setPendingAction('save');
    try {
      const nextPreset: ConversationAutomationWorkflowPreset = {
        id: selectedPreset?.id ?? createDraftId('preset'),
        name: presetNameDraft.trim(),
        updatedAt: new Date().toISOString(),
        items: normalizedItems,
      };
      const otherPresets = (data.presetLibrary.presets ?? []).filter((preset) => preset.id !== nextPreset.id).map(clonePreset);
      const nextPresets = [...otherPresets, nextPreset].sort((left, right) => left.name.localeCompare(right.name));
      await savePresets(nextPresets, data.presetLibrary.defaultPresetIds);
      navigate(`/plans${buildAutomationSearch(location.search, nextPreset.id)}`, { replace: true });
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDelete() {
    if (!data || !selectedPreset || pendingAction) {
      return;
    }

    setActionError(null);
    setPendingAction('delete');
    try {
      const nextPresets = data.presetLibrary.presets.filter((preset) => preset.id !== selectedPreset.id).map(clonePreset);
      const nextDefaultPresetIds = data.presetLibrary.defaultPresetIds.filter((id) => id !== selectedPreset.id);
      await savePresets(nextPresets, nextDefaultPresetIds);
      navigate('/plans', { replace: true });
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleToggleDefault() {
    if (!data || !selectedPreset || pendingAction) {
      return;
    }

    setActionError(null);
    setPendingAction('default');
    try {
      const isDefault = data.presetLibrary.defaultPresetIds.includes(selectedPreset.id);
      const nextDefaultPresetIds = isDefault
        ? data.presetLibrary.defaultPresetIds.filter((id) => id !== selectedPreset.id)
        : [...data.presetLibrary.defaultPresetIds, selectedPreset.id];
      await savePresets(data.presetLibrary.presets.map(clonePreset), nextDefaultPresetIds);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPendingAction(null);
    }
  }

  if (loading && !data) {
    return <LoadingState label="Loading checklists…" className="justify-center h-full" />;
  }

  if (error && !data) {
    return <ErrorState message={`Failed to load checklists: ${error}`} className="px-4 py-4" />;
  }

  if (!data || !panelKey) {
    return null;
  }

  const isDefault = selectedPreset ? data.presetLibrary.defaultPresetIds.includes(selectedPreset.id) : false;

  return (
    <div className="space-y-6 px-4 py-4">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="ui-card-title break-words">{creatingNew ? 'New checklist' : (selectedPreset?.name ?? 'Checklist')}</p>
            <p className="mt-1 text-[12px] text-secondary">Reusable todo list for the agent.</p>
          </div>
          {selectedPreset && isDefault && <Pill tone="accent">default</Pill>}
        </div>
        <input
          value={presetNameDraft}
          onChange={(event) => setPresetNameDraft(event.target.value)}
          placeholder="Checklist name"
          className={INPUT_CLASS}
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="ui-section-label">Todo list</p>
            <p className="mt-1 text-[12px] text-secondary">Ordered checklist items for the agent.</p>
          </div>
          <div className="flex items-center gap-2">
            <ToolbarButton onClick={() => setAppendOpen((value) => !value)} disabled={pendingAction !== null}>
              Append checklist
            </ToolbarButton>
            <ToolbarButton
              onClick={() => setDraftItems((current) => [...current, createChecklistDraftItem()])}
              disabled={pendingAction !== null}
            >
              + Add item
            </ToolbarButton>
          </div>
        </div>

        {appendOpen && (
          <div className="space-y-2 border-t border-border-subtle/70 pt-3">
            <input
              value={appendQuery}
              onChange={(event) => setAppendQuery(event.target.value)}
              placeholder="Search checklists"
              className={INPUT_CLASS}
            />
            <div className="space-y-px">
              {visibleAppendPresets.map((preset) => (
                <ListButtonRow
                  key={preset.id}
                  onClick={() => {
                    setDraftItems((current) => appendChecklistPresetItems(current, preset));
                    setAppendOpen(false);
                    setAppendQuery('');
                  }}
                  className="-mx-0 px-0 py-2"
                  trailing={<span className="text-[11px] text-accent">Append</span>}
                >
                  <p className="ui-row-title truncate">{preset.name}</p>
                  <p className="ui-row-meta">{preset.items.length} {preset.items.length === 1 ? 'item' : 'items'}</p>
                </ListButtonRow>
              ))}
              {visibleAppendPresets.length === 0 && <p className="text-[11px] text-dim">No checklists match that search.</p>}
            </div>
          </div>
        )}

        {draftItems.length === 0 ? (
          <p className="border-t border-border-subtle/70 pt-3 text-[12px] text-dim">No items yet.</p>
        ) : (
          <div className="divide-y divide-border-subtle/70 border-t border-border-subtle/70">
            {draftItems.map((item, index) => (
              <div
                key={item.id}
                className={cx('grid gap-3 px-0 py-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start', draggingItemId === item.id && 'opacity-60')}
                onDragOver={(event) => {
                  if (!draggingItemId || draggingItemId === item.id) {
                    return;
                  }
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!draggingItemId) {
                    return;
                  }
                  setDraftItems((current) => moveDraftItem(current, draggingItemId, item.id));
                  setDraggingItemId(null);
                }}
              >
                <button
                  type="button"
                  draggable={pendingAction === null}
                  onDragStart={() => setDraggingItemId(item.id)}
                  onDragEnd={() => setDraggingItemId(null)}
                  className="mt-2 flex h-8 w-8 items-center justify-center rounded-lg border border-border-default bg-base text-[12px] text-dim"
                  title="Drag to reorder"
                >
                  ⋮⋮
                </button>

                <div className="min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-dim">Item {index + 1}</span>
                    <span className="text-[10px] uppercase tracking-[0.14em] text-dim">{summarizeChecklistText(item.text)}</span>
                  </div>
                  <textarea
                    value={item.text}
                    onChange={(event) => setDraftItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, text: event.target.value } : candidate))}
                    placeholder="Type anything the agent should do. You can use /skill:..., slash commands, or plain text."
                    className={TEXTAREA_CLASS}
                  />
                </div>

                <div className="flex items-center gap-1 justify-self-start lg:justify-self-end lg:pt-2">
                  <ToolbarButton onClick={() => setDraftItems((current) => current.filter((candidate) => candidate.id !== item.id))} className="text-danger">
                    Remove
                  </ToolbarButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle/70 pt-3">
        <ToolbarButton onClick={() => { void handleSave(); }} disabled={pendingAction !== null || !editorDirty}>Save</ToolbarButton>
        {selectedPreset && (
          <>
            <ToolbarButton onClick={() => { void handleToggleDefault(); }} disabled={pendingAction !== null}>
              {isDefault ? 'Remove default' : 'Make default'}
            </ToolbarButton>
            <ToolbarButton onClick={() => { void handleDelete(); }} disabled={pendingAction !== null} className="text-danger">
              Delete
            </ToolbarButton>
          </>
        )}
      </div>

      {actionError && <p className="text-[12px] text-danger">{actionError}</p>}
    </div>
  );
}
