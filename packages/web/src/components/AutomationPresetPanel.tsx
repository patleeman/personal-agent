import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import {
  checklistDraftItemsToTemplateItems,
  type ChecklistDraftItem,
  toChecklistDraftItems,
} from '../checklists';
import { useApi } from '../hooks';
import type { ConversationAutomationWorkflowPreset } from '../types';
import { ChecklistComposer, ChecklistItemList } from './ChecklistEditor';
import { ErrorState, LoadingState, Pill, ToolbarButton } from './ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';

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
  const availablePresets = useMemo(
    () => (data?.presetLibrary.presets ?? []).filter((preset) => preset.id !== selectedPreset?.id),
    [data?.presetLibrary.presets, selectedPreset?.id],
  );

  useEffect(() => {
    if (!data || !panelKey || initializedKey === panelKey) {
      return;
    }

    setPresetNameDraft(creatingNew ? 'New preset' : (selectedPreset?.name ?? ''));
    setDraftItems(creatingNew ? [] : toChecklistDraftItems(selectedPreset?.items ?? []));
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
    return <LoadingState label="Loading presets…" className="justify-center h-full" />;
  }

  if (error && !data) {
    return <ErrorState message={`Failed to load presets: ${error}`} className="px-4 py-4" />;
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
            <p className="ui-card-title break-words">{creatingNew ? 'New preset' : (selectedPreset?.name ?? 'Preset')}</p>
            <p className="mt-1 text-[12px] text-secondary">Reusable preset for the agent.</p>
          </div>
          {selectedPreset && isDefault && <Pill tone="accent">default</Pill>}
        </div>
        <input
          value={presetNameDraft}
          onChange={(event) => {
            setPresetNameDraft(event.target.value);
            if (actionError) {
              setActionError(null);
            }
          }}
          placeholder="Preset name"
          className={INPUT_CLASS}
        />
      </div>

      <div className="space-y-3">
        <div>
          <p className="ui-section-label">Todo list</p>
          <p className="mt-1 text-[12px] text-secondary">Ordered preset items for the agent.</p>
        </div>

        <div className="border-t border-border-subtle/70">
          <ChecklistItemList
            items={draftItems}
            textDisabled={pendingAction !== null}
            structureDisabled={pendingAction !== null}
            emptyState="Nothing here yet. Add the first preset item below."
            onChange={(nextItems) => {
              setDraftItems(nextItems);
              if (actionError) {
                setActionError(null);
              }
            }}
          />
        </div>

        <ChecklistComposer
          currentItems={draftItems}
          skills={data.skills}
          presets={availablePresets}
          disabled={pendingAction !== null}
          onAdd={(nextItems) => {
            setDraftItems(nextItems);
          }}
          onErrorChange={setActionError}
        />
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
