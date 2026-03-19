import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import type {
  ConversationAutomationTemplateTodoItem,
  ConversationAutomationWorkflowPreset,
} from '../types';
import { ErrorState, LoadingState, Pill, ToolbarButton, cx } from './ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';

function createDraftId(prefix: 'item' | 'preset'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildAutomationSearch(locationSearch: string, presetId: string | null, creatingNew = false): string {
  const params = new URLSearchParams(locationSearch);

  if (presetId) {
    params.set('preset', presetId);
  } else {
    params.delete('preset');
  }

  if (creatingNew) {
    params.set('new', '1');
  } else {
    params.delete('new');
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

function cloneItem(item: ConversationAutomationTemplateTodoItem): ConversationAutomationTemplateTodoItem {
  return {
    id: item.id,
    label: item.label,
    skillName: item.skillName,
    ...(item.skillArgs ? { skillArgs: item.skillArgs } : {}),
  };
}

function clonePreset(preset: ConversationAutomationWorkflowPreset): ConversationAutomationWorkflowPreset {
  return {
    id: preset.id,
    name: preset.name,
    updatedAt: preset.updatedAt,
    items: preset.items.map(cloneItem),
  };
}

function createEmptyItem(skillName = ''): ConversationAutomationTemplateTodoItem {
  return {
    id: createDraftId('item'),
    label: skillName || 'Automation item',
    skillName,
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
  } = useApi(api.conversationAutomationWorkspace);
  const [initializedKey, setInitializedKey] = useState<string | null>(null);
  const [presetNameDraft, setPresetNameDraft] = useState('');
  const [draftItems, setDraftItems] = useState<ConversationAutomationTemplateTodoItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'save' | 'delete' | 'default' | null>(null);
  const [newSkillName, setNewSkillName] = useState('');

  const selectedPreset = useMemo(
    () => presetId && data ? data.presetLibrary.presets.find((preset) => preset.id === presetId) ?? null : null,
    [data, presetId],
  );
  const panelKey = creatingNew ? 'new' : selectedPreset?.id ?? null;
  const skillNames = data?.skills.map((skill) => skill.name) ?? [];
  const selectedItem = draftItems.find((item) => item.id === selectedItemId) ?? null;
  const baseline = useMemo(() => JSON.stringify({
    name: selectedPreset?.name ?? '',
    items: selectedPreset?.items ?? [],
  }), [selectedPreset]);
  const editorDirty = JSON.stringify({ name: presetNameDraft, items: draftItems }) !== baseline;

  useEffect(() => {
    if (!data || !panelKey || initializedKey === panelKey) {
      return;
    }

    if (creatingNew) {
      const fallbackSkill = data.skills[0]?.name ?? '';
      const firstItem = createEmptyItem(fallbackSkill);
      setPresetNameDraft('New automation preset');
      setDraftItems(fallbackSkill ? [firstItem] : []);
      setSelectedItemId(fallbackSkill ? firstItem.id : null);
      setNewSkillName(fallbackSkill);
    } else if (selectedPreset) {
      const cloned = selectedPreset.items.map(cloneItem);
      setPresetNameDraft(selectedPreset.name);
      setDraftItems(cloned);
      setSelectedItemId(cloned[0]?.id ?? null);
      setNewSkillName(data.skills[0]?.name ?? '');
    }

    setActionError(null);
    setPendingAction(null);
    setInitializedKey(panelKey);
  }, [creatingNew, data, initializedKey, panelKey, selectedPreset]);

  function updateDraftItems(updater: (current: ConversationAutomationTemplateTodoItem[]) => ConversationAutomationTemplateTodoItem[]) {
    setDraftItems((current) => updater(current));
  }

  function moveItem(itemId: string, direction: -1 | 1) {
    updateDraftItems((current) => {
      const index = current.findIndex((item) => item.id === itemId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [item] = next.splice(index, 1);
      if (!item) {
        return current;
      }
      next.splice(nextIndex, 0, item);
      return next;
    });
  }

  function addItem(skillName = newSkillName) {
    if (!skillName.trim()) {
      return;
    }

    const item = createEmptyItem(skillName.trim());
    updateDraftItems((current) => [...current, item]);
    setSelectedItemId(item.id);
  }

  function removeItem(itemId: string) {
    updateDraftItems((current) => current.filter((item) => item.id !== itemId));
    setSelectedItemId((current) => current === itemId ? null : current);
  }

  async function savePresets(nextPresets: ConversationAutomationWorkflowPreset[], nextDefaultPresetIds: string[]) {
    await api.updateConversationAutomationWorkflowPresets({
      presets: nextPresets,
      defaultPresetIds: nextDefaultPresetIds,
    });
    await refetch({ resetLoading: false });
  }

  async function handleSave() {
    if (!data || pendingAction || !presetNameDraft.trim()) {
      return;
    }
    if (draftItems.length === 0) {
      setActionError('Add at least one item.');
      return;
    }

    setActionError(null);
    setPendingAction('save');
    try {
      const nextPreset: ConversationAutomationWorkflowPreset = {
        id: selectedPreset?.id ?? createDraftId('preset'),
        name: presetNameDraft.trim(),
        updatedAt: selectedPreset?.updatedAt ?? new Date().toISOString(),
        items: draftItems.map(cloneItem),
      };
      const otherPresets = (data.presetLibrary.presets ?? []).filter((preset) => preset.id !== nextPreset.id).map(clonePreset);
      const nextPresets = [...otherPresets, nextPreset].sort((left, right) => left.name.localeCompare(right.name));
      await savePresets(nextPresets, data.presetLibrary.defaultPresetIds);
      navigate(`/automation${buildAutomationSearch(location.search, nextPreset.id)}`, { replace: true });
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
      const nextPresets = data.presetLibrary.presets
        .filter((preset) => preset.id !== selectedPreset.id)
        .map(clonePreset);
      const nextDefaultPresetIds = data.presetLibrary.defaultPresetIds.filter((id) => id !== selectedPreset.id);
      await savePresets(nextPresets, nextDefaultPresetIds);
      navigate('/automation', { replace: true });
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
    return <LoadingState label="Loading automation presets…" className="justify-center h-full" />;
  }

  if (error && !data) {
    return <ErrorState message={`Failed to load automation presets: ${error}`} className="px-4 py-4" />;
  }

  if (!data || !panelKey) {
    return null;
  }

  const isDefault = selectedPreset ? data.presetLibrary.defaultPresetIds.includes(selectedPreset.id) : false;

  return (
    <div className="space-y-5 px-4 py-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="ui-card-title break-words">{creatingNew ? 'New automation preset' : (selectedPreset?.name ?? 'Automation preset')}</p>
          {selectedPreset && isDefault && <Pill tone="accent">default</Pill>}
        </div>
        <input
          id="automation-preset-name"
          value={presetNameDraft}
          onChange={(event) => setPresetNameDraft(event.target.value)}
          placeholder="Preset name"
          className={INPUT_CLASS}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="ui-section-label">Todo items</p>
          <div className="flex items-center gap-2">
            <select
              value={newSkillName}
              onChange={(event) => setNewSkillName(event.target.value)}
              className={INPUT_CLASS}
            >
              {skillNames.length === 0 ? <option value="">No skills available</option> : skillNames.map((skillName) => <option key={skillName} value={skillName}>{skillName}</option>)}
            </select>
            <ToolbarButton onClick={() => addItem()} disabled={!newSkillName.trim()}>Add item</ToolbarButton>
          </div>
        </div>

        {draftItems.length === 0 ? (
          <p className="text-[12px] text-dim">No items yet. Add at least one skill.</p>
        ) : (
          <div className="space-y-2">
            {draftItems.map((item, index) => (
              <div
                key={item.id}
                onClick={() => setSelectedItemId(item.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedItemId(item.id);
                  }
                }}
                role="button"
                tabIndex={0}
                className={cx(
                  'w-full rounded-lg px-3 py-3 text-left transition-colors cursor-pointer',
                  selectedItem?.id === item.id ? 'bg-surface text-primary ring-1 ring-accent/30' : 'bg-base/50 text-secondary',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium truncate">{index + 1}. {item.label}</p>
                    <p className="text-[11px] text-dim truncate">/skill:{item.skillName}{item.skillArgs ? ` ${item.skillArgs}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <ToolbarButton onClick={(event) => { event.stopPropagation(); moveItem(item.id, -1); }} disabled={index === 0}>↑</ToolbarButton>
                    <ToolbarButton onClick={(event) => { event.stopPropagation(); moveItem(item.id, 1); }} disabled={index === draftItems.length - 1}>↓</ToolbarButton>
                    <ToolbarButton onClick={(event) => { event.stopPropagation(); removeItem(item.id); }} className="text-danger">Remove</ToolbarButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedItem && (
        <div className="space-y-3">
          <p className="ui-section-label">Selected item</p>
          <div className="space-y-2">
            <label className="ui-card-meta" htmlFor="automation-item-label">Label</label>
            <input
              id="automation-item-label"
              value={selectedItem.label}
              onChange={(event) => updateDraftItems((current) => current.map((item) => item.id === selectedItem.id ? { ...item, label: event.target.value } : item))}
              className={INPUT_CLASS}
            />
          </div>
          <div className="space-y-2">
            <label className="ui-card-meta" htmlFor="automation-item-skill-name">Skill</label>
            <select
              id="automation-item-skill-name"
              value={selectedItem.skillName}
              onChange={(event) => updateDraftItems((current) => current.map((item) => item.id === selectedItem.id ? { ...item, skillName: event.target.value, label: item.label || event.target.value } : item))}
              className={INPUT_CLASS}
            >
              {skillNames.map((skillName) => <option key={skillName} value={skillName}>{skillName}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="ui-card-meta" htmlFor="automation-item-skill-args">Skill args</label>
            <input
              id="automation-item-skill-args"
              value={selectedItem.skillArgs ?? ''}
              onChange={(event) => updateDraftItems((current) => current.map((item) => item.id === selectedItem.id ? { ...item, skillArgs: event.target.value } : item))}
              placeholder="Optional args"
              className={INPUT_CLASS}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
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
