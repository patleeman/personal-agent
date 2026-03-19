import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import type {
  ConversationAutomationTemplateTodoItem,
  ConversationAutomationTodoItemKind,
  ConversationAutomationWorkflowPreset,
} from '../types';
import { ErrorState, LoadingState, Pill, ToolbarButton } from './ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[92px] resize-y leading-relaxed`;

function createDraftId(prefix: 'item' | 'preset'): string {
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

function summarizeInstructionLabel(text: string): string {
  const singleLine = text.trim().replace(/\s+/g, ' ');
  if (singleLine.length <= 72) {
    return singleLine;
  }
  return `${singleLine.slice(0, 69).trimEnd()}…`;
}

function normalizeArgs(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  return normalized || undefined;
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function isSkillItem(item: ConversationAutomationTemplateTodoItem): item is Extract<ConversationAutomationTemplateTodoItem, { kind?: 'skill' }> {
  return item.kind !== 'instruction';
}

function isInstructionItem(item: ConversationAutomationTemplateTodoItem): item is Extract<ConversationAutomationTemplateTodoItem, { kind: 'instruction' }> {
  return item.kind === 'instruction';
}

function cloneItem(item: ConversationAutomationTemplateTodoItem): ConversationAutomationTemplateTodoItem {
  return item.kind === 'instruction'
    ? {
      id: item.id,
      kind: 'instruction',
      label: item.label,
      text: item.text,
    }
    : {
      id: item.id,
      kind: 'skill',
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

function createSkillItem(skillName: string, skillArgs = ''): Extract<ConversationAutomationTemplateTodoItem, { kind: 'skill' }> {
  const normalizedSkillName = skillName.trim();
  const normalizedSkillArgs = normalizeArgs(skillArgs);

  return {
    id: createDraftId('item'),
    kind: 'skill',
    label: normalizedSkillName || 'Skill step',
    skillName: normalizedSkillName,
    ...(normalizedSkillArgs ? { skillArgs: normalizedSkillArgs } : {}),
  };
}

function createInstructionItem(text: string): Extract<ConversationAutomationTemplateTodoItem, { kind: 'instruction' }> {
  const normalizedText = normalizeText(text) ?? '';
  return {
    id: createDraftId('item'),
    kind: 'instruction',
    label: summarizeInstructionLabel(normalizedText || 'Custom step'),
    text: normalizedText,
  };
}

function normalizeDraftItem(item: ConversationAutomationTemplateTodoItem): ConversationAutomationTemplateTodoItem {
  if (item.kind === 'instruction') {
    const text = normalizeText(item.text) ?? '';
    return {
      id: item.id,
      kind: 'instruction',
      label: summarizeInstructionLabel(text),
      text,
    };
  }

  const skillName = item.skillName.trim();
  const skillArgs = normalizeArgs(item.skillArgs);
  return {
    id: item.id,
    kind: 'skill',
    label: skillName || item.label || 'Skill step',
    skillName,
    ...(skillArgs ? { skillArgs } : {}),
  };
}

function formatItemInvocation(item: ConversationAutomationTemplateTodoItem): string {
  if (item.kind === 'instruction') {
    return item.text;
  }
  return `/skill:${item.skillName}${item.skillArgs ? ` ${item.skillArgs}` : ''}`;
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
  const [draftItems, setDraftItems] = useState<ConversationAutomationTemplateTodoItem[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'save' | 'delete' | 'default' | null>(null);
  const [newItemKind, setNewItemKind] = useState<ConversationAutomationTodoItemKind>('skill');
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillArgs, setNewSkillArgs] = useState('');
  const [newInstructionText, setNewInstructionText] = useState('');

  const selectedPreset = useMemo(
    () => presetId && data ? data.presetLibrary.presets.find((preset) => preset.id === presetId) ?? null : null,
    [data, presetId],
  );
  const panelKey = creatingNew ? 'new' : selectedPreset?.id ?? null;
  const skillNames = data?.skills.map((skill) => skill.name) ?? [];
  const baseline = useMemo(() => JSON.stringify({
    name: selectedPreset?.name ?? '',
    items: selectedPreset?.items ?? [],
  }), [selectedPreset]);
  const editorDirty = JSON.stringify({ name: presetNameDraft, items: draftItems }) !== baseline;

  useEffect(() => {
    if (!data || !panelKey || initializedKey === panelKey) {
      return;
    }

    const fallbackSkill = data.skills[0]?.name ?? '';
    setPresetNameDraft(creatingNew ? 'New plan' : (selectedPreset?.name ?? ''));
    setDraftItems(creatingNew ? [] : (selectedPreset?.items.map(cloneItem) ?? []));
    setNewItemKind(fallbackSkill ? 'skill' : 'instruction');
    setNewSkillName(fallbackSkill);
    setNewSkillArgs('');
    setNewInstructionText('');
    setActionError(null);
    setPendingAction(null);
    setInitializedKey(panelKey);
  }, [creatingNew, data, initializedKey, panelKey, selectedPreset]);

  function updateDraftItems(updater: (current: ConversationAutomationTemplateTodoItem[]) => ConversationAutomationTemplateTodoItem[]) {
    setDraftItems((current) => updater(current));
  }

  function updateDraftItem(itemId: string, updater: (item: ConversationAutomationTemplateTodoItem) => ConversationAutomationTemplateTodoItem) {
    updateDraftItems((current) => current.map((item) => item.id === itemId ? updater(item) : item));
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

  function addItem() {
    if (newItemKind === 'instruction') {
      const text = normalizeText(newInstructionText);
      if (!text) {
        return;
      }
      updateDraftItems((current) => [...current, createInstructionItem(text)]);
      setNewInstructionText('');
      return;
    }

    if (!newSkillName.trim()) {
      return;
    }
    updateDraftItems((current) => [...current, createSkillItem(newSkillName, newSkillArgs)]);
    setNewSkillArgs('');
  }

  function removeItem(itemId: string) {
    updateDraftItems((current) => current.filter((item) => item.id !== itemId));
  }

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
    if (draftItems.length === 0) {
      setActionError('Add at least one step.');
      return;
    }

    const normalizedItems = draftItems.map(normalizeDraftItem);
    const hasInvalidInstruction = normalizedItems.some((item) => item.kind === 'instruction' && item.text.trim().length === 0);
    const hasInvalidSkill = normalizedItems.some((item) => item.kind === 'skill' && item.skillName.trim().length === 0);
    if (hasInvalidInstruction || hasInvalidSkill) {
      setActionError('Each step needs either a skill or custom text.');
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
      const nextPresets = data.presetLibrary.presets
        .filter((preset) => preset.id !== selectedPreset.id)
        .map(clonePreset);
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
    return <LoadingState label="Loading plans…" className="justify-center h-full" />;
  }

  if (error && !data) {
    return <ErrorState message={`Failed to load plans: ${error}`} className="px-4 py-4" />;
  }

  if (!data || !panelKey) {
    return null;
  }

  const isDefault = selectedPreset ? data.presetLibrary.defaultPresetIds.includes(selectedPreset.id) : false;
  const canAddItem = newItemKind === 'instruction'
    ? Boolean(normalizeText(newInstructionText))
    : Boolean(newSkillName.trim());

  return (
    <div className="space-y-5 px-4 py-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="ui-card-title break-words">{creatingNew ? 'New plan' : (selectedPreset?.name ?? 'Plan')}</p>
          {selectedPreset && isDefault && <Pill tone="accent">default</Pill>}
        </div>
        <input
          id="automation-preset-name"
          value={presetNameDraft}
          onChange={(event) => setPresetNameDraft(event.target.value)}
          placeholder="Plan name"
          className={INPUT_CLASS}
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="ui-section-label">Steps</p>
          <div className="grid w-full gap-2 xl:max-w-4xl">
            <div className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)_auto]">
              <select
                value={newItemKind}
                onChange={(event) => setNewItemKind(event.target.value as ConversationAutomationTodoItemKind)}
                className={INPUT_CLASS}
              >
                <option value="skill">Skill</option>
                <option value="instruction">Custom text</option>
              </select>

              {newItemKind === 'instruction' ? (
                <textarea
                  value={newInstructionText}
                  onChange={(event) => setNewInstructionText(event.target.value)}
                  placeholder="Describe the exact step the agent should carry out"
                  className={TEXTAREA_CLASS}
                />
              ) : (
                <div className="grid gap-2 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                  <select
                    value={newSkillName}
                    onChange={(event) => setNewSkillName(event.target.value)}
                    className={INPUT_CLASS}
                  >
                    {skillNames.length === 0 ? <option value="">No skills available</option> : skillNames.map((skillName) => <option key={skillName} value={skillName}>{skillName}</option>)}
                  </select>
                  <input
                    value={newSkillArgs}
                    onChange={(event) => setNewSkillArgs(event.target.value)}
                    placeholder="Optional args"
                    className={INPUT_CLASS}
                  />
                </div>
              )}

              <ToolbarButton onClick={addItem} disabled={!canAddItem}>{newItemKind === 'instruction' ? 'Add text step' : 'Add step'}</ToolbarButton>
            </div>
          </div>
        </div>

        {draftItems.length === 0 ? (
          <p className="text-[12px] text-dim">No steps yet. Add the first one above.</p>
        ) : (
          <div className="space-y-2">
            {draftItems.map((item, index) => (
              <div key={item.id} className="rounded-lg bg-base/50 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-dim">Step {index + 1}</p>
                    <Pill tone="muted">{item.kind === 'instruction' ? 'text' : 'skill'}</Pill>
                  </div>
                  <div className="flex items-center gap-1">
                    <ToolbarButton onClick={() => moveItem(item.id, -1)} disabled={index === 0}>↑</ToolbarButton>
                    <ToolbarButton onClick={() => moveItem(item.id, 1)} disabled={index === draftItems.length - 1}>↓</ToolbarButton>
                    <ToolbarButton onClick={() => removeItem(item.id)} className="text-danger">Remove</ToolbarButton>
                  </div>
                </div>

                {isInstructionItem(item) ? (
                  <div className="mt-3 space-y-1.5">
                    <label className="ui-card-meta" htmlFor={`automation-item-text-${item.id}`}>Step text</label>
                    <textarea
                      id={`automation-item-text-${item.id}`}
                      value={item.text}
                      onChange={(event) => updateDraftItem(item.id, () => {
                        const text = event.target.value;
                        return {
                          id: item.id,
                          kind: 'instruction',
                          label: summarizeInstructionLabel(text || 'Custom step'),
                          text,
                        };
                      })}
                      className={TEXTAREA_CLASS}
                    />
                  </div>
                ) : null}

                {isSkillItem(item) ? (
                  <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                    <div className="space-y-1.5">
                      <label className="ui-card-meta" htmlFor={`automation-item-skill-${item.id}`}>Skill</label>
                      <select
                        id={`automation-item-skill-${item.id}`}
                        value={item.skillName}
                        onChange={(event) => updateDraftItem(item.id, (current) => ({
                          ...(current.kind === 'skill' ? current : createSkillItem(event.target.value)),
                          id: item.id,
                          kind: 'skill',
                          label: event.target.value,
                          skillName: event.target.value,
                        }))}
                        className={INPUT_CLASS}
                      >
                        {skillNames.map((skillName) => <option key={skillName} value={skillName}>{skillName}</option>)}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="ui-card-meta" htmlFor={`automation-item-args-${item.id}`}>Args</label>
                      <input
                        id={`automation-item-args-${item.id}`}
                        value={item.skillArgs ?? ''}
                        onChange={(event) => updateDraftItem(item.id, (current) => ({
                          ...(current.kind === 'skill' ? current : createSkillItem(item.skillName)),
                          id: item.id,
                          kind: 'skill',
                          label: item.skillName,
                          skillName: item.skillName,
                          skillArgs: normalizeArgs(event.target.value),
                        }))}
                        placeholder="Optional args"
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>
                ) : null}

                <p className="mt-2 text-[11px] text-dim break-words">
                  {item.kind === 'instruction' ? 'Runs with this instruction:' : 'Runs as '}<span className="font-mono text-secondary whitespace-pre-wrap">{formatItemInvocation(item)}</span>
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

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
