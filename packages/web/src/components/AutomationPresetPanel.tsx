import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { formatContextWindowLabel } from '../conversationHeader';
import { api } from '../api';
import { useApi } from '../hooks';
import { groupModelsByProvider } from '../modelPreferences';
import type {
  ConversationAutomationTemplateGate,
  ConversationAutomationTemplateSkillStep,
  ConversationAutomationWorkflowPreset,
  ModelState,
} from '../types';
import { EmptyState, ErrorState, LoadingState, Pill, ToolbarButton, cx } from './ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';
const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-[144px] resize-y leading-relaxed`;
const DRAG_HANDLE_CLASS = 'inline-flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-[14px] text-dim transition-colors hover:bg-surface hover:text-primary active:cursor-grabbing';

type EditorSelection =
  | { kind: 'gate'; gateId: string }
  | { kind: 'skill'; gateId: string; skillId: string }
  | null;

type DragItem =
  | { kind: 'gate'; gateId: string }
  | { kind: 'skill'; gateId: string; skillId: string }
  | null;

type DropTarget =
  | { kind: 'gate'; gateId: string | null }
  | { kind: 'skill'; gateId: string; skillId: string | null }
  | null;

type ModelOption = ModelState['models'][number];

function createDraftId(prefix: 'gate' | 'skill' | 'preset'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneTemplateSkill(skill: ConversationAutomationTemplateSkillStep): ConversationAutomationTemplateSkillStep {
  return {
    id: skill.id,
    label: skill.label,
    skillName: skill.skillName,
    ...(skill.skillArgs ? { skillArgs: skill.skillArgs } : {}),
  };
}

function cloneTemplateGate(gate: ConversationAutomationTemplateGate): ConversationAutomationTemplateGate {
  return {
    id: gate.id,
    label: gate.label,
    prompt: gate.prompt,
    skills: gate.skills.map(cloneTemplateSkill),
  };
}

function clonePreset(preset: ConversationAutomationWorkflowPreset): ConversationAutomationWorkflowPreset {
  return {
    id: preset.id,
    name: preset.name,
    updatedAt: preset.updatedAt,
    gates: preset.gates.map(cloneTemplateGate),
  };
}

function cloneGates(gates: ConversationAutomationTemplateGate[]): ConversationAutomationTemplateGate[] {
  return gates.map(cloneTemplateGate);
}

function createEmptyGate(): ConversationAutomationTemplateGate {
  return {
    id: createDraftId('gate'),
    label: 'Automation rule',
    prompt: 'repo:personal-agent AND judge:"Did the assistant complete the task?"',
    skills: [],
  };
}

function createSkillDraft(skillName: string, fallbackLabel?: string): ConversationAutomationTemplateSkillStep {
  return {
    id: createDraftId('skill'),
    label: fallbackLabel || skillName || 'Skill step',
    skillName,
  };
}

function splitModelRef(modelRef: string): { provider: string; model: string } {
  const slashIndex = modelRef.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= modelRef.length - 1) {
    return { provider: '', model: modelRef };
  }

  return {
    provider: modelRef.slice(0, slashIndex),
    model: modelRef.slice(slashIndex + 1),
  };
}

function findModelByRef(models: ModelOption[], modelRef: string): ModelOption | null {
  if (!modelRef) {
    return null;
  }

  const { provider, model } = splitModelRef(modelRef);
  if (provider) {
    return models.find((candidate) => candidate.provider === provider && candidate.id === model) ?? null;
  }

  return models.find((candidate) => candidate.id === modelRef) ?? null;
}

function formatModelSummary(model: ModelOption | null, fallback: string): string {
  if (!model) {
    return fallback;
  }

  return `${model.id} · ${model.provider} · ${formatContextWindowLabel(model.context)} ctx`;
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

function reorderGates(
  gates: ConversationAutomationTemplateGate[],
  draggedGateId: string,
  targetGateId: string | null,
): ConversationAutomationTemplateGate[] {
  const next = cloneGates(gates);
  const sourceIndex = next.findIndex((gate) => gate.id === draggedGateId);
  if (sourceIndex < 0) {
    return gates;
  }

  if (targetGateId === draggedGateId) {
    return gates;
  }

  const [draggedGate] = next.splice(sourceIndex, 1);
  if (!draggedGate) {
    return gates;
  }

  const insertIndex = targetGateId
    ? next.findIndex((gate) => gate.id === targetGateId)
    : next.length;

  if (insertIndex < 0) {
    next.push(draggedGate);
  } else {
    next.splice(insertIndex, 0, draggedGate);
  }

  return next;
}

function moveSkill(
  gates: ConversationAutomationTemplateGate[],
  draggedGateId: string,
  draggedSkillId: string,
  targetGateId: string,
  targetSkillId: string | null,
): ConversationAutomationTemplateGate[] {
  if (draggedGateId === targetGateId && targetSkillId === draggedSkillId) {
    return gates;
  }

  const next = cloneGates(gates);
  const sourceGate = next.find((gate) => gate.id === draggedGateId);
  const targetGate = next.find((gate) => gate.id === targetGateId);
  if (!sourceGate || !targetGate) {
    return gates;
  }

  const sourceIndex = sourceGate.skills.findIndex((skill) => skill.id === draggedSkillId);
  if (sourceIndex < 0) {
    return gates;
  }

  const [draggedSkill] = sourceGate.skills.splice(sourceIndex, 1);
  if (!draggedSkill) {
    return gates;
  }

  const insertIndex = targetSkillId
    ? targetGate.skills.findIndex((skill) => skill.id === targetSkillId)
    : targetGate.skills.length;

  if (insertIndex < 0) {
    targetGate.skills.push(draggedSkill);
  } else {
    targetGate.skills.splice(insertIndex, 0, draggedSkill);
  }

  return next;
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
    refreshing,
    error,
    refetch,
  } = useApi(api.conversationAutomationWorkspace);
  const {
    data: modelState,
    loading: modelsLoading,
    error: modelsError,
  } = useApi(api.models);
  const [initializedKey, setInitializedKey] = useState<string | null>(null);
  const [draftGates, setDraftGates] = useState<ConversationAutomationTemplateGate[]>([]);
  const [draftBaselineJson, setDraftBaselineJson] = useState('[]');
  const [selection, setSelection] = useState<EditorSelection>(null);
  const [presetNameDraft, setPresetNameDraft] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [judgeModelError, setJudgeModelError] = useState<string | null>(null);
  const [filterValidation, setFilterValidation] = useState<{ query: string; valid: boolean; error: string | null; validating: boolean } | null>(null);
  const [presetAction, setPresetAction] = useState<'saveNew' | 'update' | 'delete' | 'default' | null>(null);
  const [savingJudgeModel, setSavingJudgeModel] = useState(false);
  const [skillPickerByGateId, setSkillPickerByGateId] = useState<Record<string, string>>({});
  const [dragItem, setDragItem] = useState<DragItem>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);

  const selectedPreset = useMemo(
    () => presetId && data ? data.presetLibrary.presets.find((preset) => preset.id === presetId) ?? null : null,
    [data, presetId],
  );
  const panelKey = creatingNew ? 'new' : selectedPreset?.id ?? null;
  const editorDirty = JSON.stringify(draftGates) !== draftBaselineJson;
  const skillNames = data?.skills.map((skill) => skill.name) ?? [];

  const selectedGate = useMemo(() => {
    if (selection?.kind === 'gate') {
      return draftGates.find((gate) => gate.id === selection.gateId) ?? null;
    }
    if (selection?.kind === 'skill') {
      return draftGates.find((gate) => gate.id === selection.gateId) ?? null;
    }
    return null;
  }, [draftGates, selection]);

  const selectedSkill = useMemo(() => {
    if (selection?.kind !== 'skill') {
      return null;
    }
    return selectedGate?.skills.find((skill) => skill.id === selection.skillId) ?? null;
  }, [selectedGate, selection]);

  const selectedSkillInfo = useMemo(
    () => selectedSkill && data ? data.skills.find((skill) => skill.name === selectedSkill.skillName) ?? null : null,
    [data, selectedSkill],
  );
  const groupedModels = useMemo(
    () => groupModelsByProvider(modelState?.models ?? []),
    [modelState],
  );
  const selectedJudgeModel = useMemo(
    () => findModelByRef(modelState?.models ?? [], data?.judge.currentModel ?? ''),
    [data?.judge.currentModel, modelState],
  );
  const effectiveJudgeModel = useMemo(
    () => findModelByRef(modelState?.models ?? [], data?.judge.effectiveModel ?? ''),
    [data?.judge.effectiveModel, modelState],
  );

  useEffect(() => {
    setInitializedKey(null);
    setDraftGates([]);
    setDraftBaselineJson('[]');
    setSelection(null);
    setPresetNameDraft('');
    setActionError(null);
    setJudgeModelError(null);
    setFilterValidation(null);
    setPresetAction(null);
    setSavingJudgeModel(false);
    setSkillPickerByGateId({});
    setDragItem(null);
    setDropTarget(null);
  }, [panelKey]);

  useEffect(() => {
    if (!data || !panelKey || initializedKey === panelKey) {
      return;
    }

    const nextDraft = creatingNew || !selectedPreset
      ? []
      : selectedPreset.gates.map(cloneTemplateGate);

    setDraftGates(nextDraft);
    setDraftBaselineJson(JSON.stringify(nextDraft));
    setSelection(nextDraft[0] ? { kind: 'gate', gateId: nextDraft[0].id } : null);
    setPresetNameDraft(creatingNew ? '' : (selectedPreset?.name ?? ''));
    setInitializedKey(panelKey);
  }, [creatingNew, data, initializedKey, panelKey, selectedPreset]);

  useEffect(() => {
    if (!data || selection?.kind !== 'gate' || !selectedGate) {
      setFilterValidation(null);
      return;
    }

    const query = selectedGate.prompt.trim();
    if (!query) {
      setFilterValidation({ query: '', valid: false, error: 'Filter is required.', validating: false });
      return;
    }

    let cancelled = false;
    setFilterValidation((current) => current && current.query === query
      ? { ...current, validating: true }
      : { query, valid: false, error: null, validating: true });

    const timer = window.setTimeout(() => {
      void api.validateConversationAutomationQuery(query)
        .then((result) => {
          if (cancelled) {
            return;
          }
          setFilterValidation({ query, valid: result.valid, error: result.error, validating: false });
        })
        .catch((nextError) => {
          if (cancelled) {
            return;
          }
          setFilterValidation({ query, valid: false, error: nextError instanceof Error ? nextError.message : String(nextError), validating: false });
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [data, selectedGate, selection]);

  function updateDraftGates(updater: (current: ConversationAutomationTemplateGate[]) => ConversationAutomationTemplateGate[]) {
    setDraftGates((current) => updater(current).map(cloneTemplateGate));
  }

  function getSkillPickerValue(gateId: string): string {
    return skillPickerByGateId[gateId] ?? skillNames[0] ?? '';
  }

  function handleAddGate() {
    const gate = createEmptyGate();
    updateDraftGates((current) => [...current, gate]);
    setSelection({ kind: 'gate', gateId: gate.id });
  }

  function handleAddSkill(gateId: string, requestedSkillName?: string) {
    if (!data || skillNames.length === 0) {
      return;
    }

    const skillName = requestedSkillName || getSkillPickerValue(gateId);
    if (!skillName) {
      return;
    }

    const selectedMeta = data.skills.find((skill) => skill.name === skillName);
    const skill = createSkillDraft(skillName, selectedMeta?.name);

    updateDraftGates((current) => current.map((gate) => gate.id === gateId
      ? { ...gate, skills: [...gate.skills, skill] }
      : gate));
    setSelection({ kind: 'skill', gateId, skillId: skill.id });
  }

  function handleDeleteGate(gateId: string) {
    updateDraftGates((current) => current.filter((gate) => gate.id !== gateId));
    setSelection((current) => current && current.gateId === gateId ? null : current);
    setSkillPickerByGateId((current) => {
      const next = { ...current };
      delete next[gateId];
      return next;
    });
  }

  function handleDeleteSkill(gateId: string, skillId: string) {
    updateDraftGates((current) => current.map((gate) => gate.id === gateId
      ? { ...gate, skills: gate.skills.filter((skill) => skill.id !== skillId) }
      : gate));
    setSelection((current) => current?.kind === 'skill' && current.skillId === skillId ? { kind: 'gate', gateId } : current);
  }

  function handleUpdateSelectedGate(patch: Partial<ConversationAutomationTemplateGate>) {
    if (!selectedGate) {
      return;
    }

    updateDraftGates((current) => current.map((gate) => gate.id === selectedGate.id ? { ...gate, ...patch } : gate));
  }

  function handleUpdateSelectedSkill(patch: Partial<ConversationAutomationTemplateSkillStep>) {
    if (!selectedGate || !selectedSkill) {
      return;
    }

    updateDraftGates((current) => current.map((gate) => {
      if (gate.id !== selectedGate.id) {
        return gate;
      }
      return {
        ...gate,
        skills: gate.skills.map((skill) => skill.id === selectedSkill.id ? { ...skill, ...patch } : skill),
      };
    }));
  }

  function clearDragState() {
    setDragItem(null);
    setDropTarget(null);
  }

  function handleDropGate(targetGateId: string | null) {
    if (!dragItem || dragItem.kind !== 'gate') {
      return;
    }

    updateDraftGates((current) => reorderGates(current, dragItem.gateId, targetGateId));
    clearDragState();
  }

  function handleDropSkill(targetGateId: string, targetSkillId: string | null) {
    if (!dragItem || dragItem.kind !== 'skill') {
      return;
    }

    updateDraftGates((current) => moveSkill(current, dragItem.gateId, dragItem.skillId, targetGateId, targetSkillId));
    setSelection((current) => current?.kind === 'skill' && current.skillId === dragItem.skillId
      ? { kind: 'skill', gateId: targetGateId, skillId: dragItem.skillId }
      : current);
    clearDragState();
  }

  async function savePresetLibrary(
    nextPresets: ConversationAutomationWorkflowPreset[],
    nextDefaultPresetIds: string[],
    action: 'saveNew' | 'update' | 'delete' | 'default',
    nextSelection?: { presetId: string | null; creatingNew?: boolean },
  ) {
    setPresetAction(action);
    setActionError(null);
    try {
      await api.updateConversationAutomationWorkflowPresets({
        presets: nextPresets.map(clonePreset),
        defaultPresetIds: nextDefaultPresetIds,
      });
      await refetch({ resetLoading: false });
      const nextSearch = buildAutomationSearch(location.search, nextSelection?.presetId ?? null, nextSelection?.creatingNew ?? false);
      navigate(`/automation${nextSearch}`, { replace: true });
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setPresetAction(null);
    }
  }

  async function handleSavePresetAsNew() {
    if (!data) {
      return;
    }

    const name = presetNameDraft.trim();
    if (!name || draftGates.length === 0 || presetAction !== null) {
      return;
    }

    const nextPresetId = createDraftId('preset');
    await savePresetLibrary([
      ...data.presetLibrary.presets,
      {
        id: nextPresetId,
        name,
        updatedAt: new Date().toISOString(),
        gates: draftGates.map(cloneTemplateGate),
      },
    ], data.presetLibrary.defaultPresetIds, 'saveNew', { presetId: nextPresetId });
  }

  async function handleUpdateSelectedPreset() {
    if (!data || !selectedPreset) {
      return;
    }

    const name = presetNameDraft.trim();
    if (!name || draftGates.length === 0 || presetAction !== null) {
      return;
    }

    await savePresetLibrary(
      data.presetLibrary.presets.map((preset) => preset.id === selectedPreset.id
        ? {
          ...preset,
          name,
          updatedAt: new Date().toISOString(),
          gates: draftGates.map(cloneTemplateGate),
        }
        : clonePreset(preset)),
      data.presetLibrary.defaultPresetIds,
      'update',
      { presetId: selectedPreset.id },
    );
  }

  async function handleDeleteSelectedPreset() {
    if (!data || !selectedPreset || presetAction !== null) {
      return;
    }

    const nextPresets = data.presetLibrary.presets.filter((preset) => preset.id !== selectedPreset.id);
    const nextDefaultPresetIds = data.presetLibrary.defaultPresetIds.filter((id) => id !== selectedPreset.id);

    await savePresetLibrary(nextPresets, nextDefaultPresetIds, 'delete', { presetId: null, creatingNew: false });
  }

  async function handleToggleDefaultPreset(nextPresetId: string) {
    if (!data || presetAction !== null) {
      return;
    }

    const nextDefaultPresetIds = data.presetLibrary.defaultPresetIds.includes(nextPresetId)
      ? data.presetLibrary.defaultPresetIds.filter((id) => id !== nextPresetId)
      : [...data.presetLibrary.defaultPresetIds, nextPresetId];

    await savePresetLibrary(data.presetLibrary.presets, nextDefaultPresetIds, 'default', {
      presetId: selectedPreset?.id ?? null,
      creatingNew,
    });
  }

  async function handleJudgeModelChange(model: string) {
    setSavingJudgeModel(true);
    setJudgeModelError(null);

    try {
      await api.updateConversationAutomationJudgeSettings({ model });
      await refetch({ resetLoading: false });
    } catch (nextError) {
      setJudgeModelError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSavingJudgeModel(false);
    }
  }

  if (loading && !data) {
    return <LoadingState label="Loading automation presets…" className="justify-center h-full" />;
  }

  if (error && !data) {
    return <ErrorState message={`Failed to load automation presets: ${error}`} className="px-4 py-4" />;
  }

  if (!data) {
    return null;
  }

  if (!creatingNew && !selectedPreset) {
    return <EmptyState className="px-4 py-8" title="Select a preset" body="Pick a preset or create a new one." />;
  }

  const isDefaultPreset = selectedPreset ? data.presetLibrary.defaultPresetIds.includes(selectedPreset.id) : false;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border-subtle px-4 py-4">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="ui-card-title break-words">{creatingNew ? 'New automation preset' : (selectedPreset?.name ?? 'Automation preset')}</p>
          {creatingNew && <Pill tone="steel">draft</Pill>}
          {isDefaultPreset && <Pill tone="accent">default</Pill>}
          {editorDirty && <Pill tone="warning">unsaved</Pill>}
          {refreshing && <span className="text-[11px] text-dim">refreshing…</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-4">
          <div className="space-y-2">
            <input
              id="automation-preset-name"
              value={presetNameDraft}
              onChange={(event) => setPresetNameDraft(event.target.value)}
              className={INPUT_CLASS}
              placeholder="Preset name"
              disabled={presetAction !== null}
            />
            <div className="flex flex-wrap gap-2">
              {creatingNew ? (
                <ToolbarButton onClick={() => { void handleSavePresetAsNew(); }} disabled={presetAction !== null || draftGates.length === 0 || presetNameDraft.trim().length === 0} className="text-accent">
                  {presetAction === 'saveNew' ? 'Saving…' : 'Save preset'}
                </ToolbarButton>
              ) : (
                <>
                  <ToolbarButton onClick={() => { void handleUpdateSelectedPreset(); }} disabled={presetAction !== null || draftGates.length === 0 || presetNameDraft.trim().length === 0 || !editorDirty} className="text-accent">
                    {presetAction === 'update' ? 'Saving…' : 'Save changes'}
                  </ToolbarButton>
                  <ToolbarButton onClick={() => { if (selectedPreset) { void handleToggleDefaultPreset(selectedPreset.id); } }} disabled={presetAction !== null || !selectedPreset}>
                    {presetAction === 'default' ? 'Saving…' : isDefaultPreset ? 'Remove from defaults' : 'Add to defaults'}
                  </ToolbarButton>
                  <ToolbarButton onClick={() => { void handleDeleteSelectedPreset(); }} disabled={presetAction !== null} className="text-danger">
                    {presetAction === 'delete' ? 'Deleting…' : 'Delete preset'}
                  </ToolbarButton>
                </>
              )}
              <Link to="/settings" className="ui-toolbar-button">Judge prompt</Link>
            </div>
          </div>

          <div className="space-y-2 border-t border-border-subtle pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="ui-section-label">Pipeline</p>
                <p className="text-[11px] text-dim">Drag gates and skills to reorder.</p>
              </div>
              <ToolbarButton onClick={handleAddGate} className="text-accent">+ gate</ToolbarButton>
            </div>

            {draftGates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-subtle px-4 py-6 text-center">
                <p className="text-[13px] text-primary">No gates yet.</p>
                <button type="button" onClick={handleAddGate} className="mt-2 text-[12px] text-accent hover:underline">Add the first gate</button>
              </div>
            ) : (
              <div className="space-y-2">
                {draftGates.map((gate, gateIndex) => {
                  const gateSelected = selection?.gateId === gate.id;
                  const gateDropActive = dragItem?.kind === 'gate' && dropTarget?.kind === 'gate' && dropTarget.gateId === gate.id;
                  const skillLaneDropActive = dragItem?.kind === 'skill' && dropTarget?.kind === 'skill' && dropTarget.gateId === gate.id && dropTarget.skillId === null;
                  const skillPickerValue = getSkillPickerValue(gate.id);

                  return (
                    <div
                      key={gate.id}
                      className={cx(
                        'rounded-xl bg-surface/60 px-3 py-3 transition-colors',
                        gateSelected && 'bg-accent/8',
                        gateDropActive && 'ring-1 ring-accent/50',
                      )}
                      onDragOver={(event) => {
                        if (dragItem?.kind !== 'gate') {
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        if (dropTarget?.kind !== 'gate' || dropTarget.gateId !== gate.id) {
                          setDropTarget({ kind: 'gate', gateId: gate.id });
                        }
                      }}
                      onDrop={(event) => {
                        if (dragItem?.kind !== 'gate') {
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        handleDropGate(gate.id);
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <div
                          draggable
                          onDragStart={() => setDragItem({ kind: 'gate', gateId: gate.id })}
                          onDragEnd={clearDragState}
                          className={DRAG_HANDLE_CLASS}
                          aria-label={`Drag ${gate.label}`}
                          title="Drag gate"
                        >
                          ⋮⋮
                        </div>
                        <button type="button" onClick={() => setSelection({ kind: 'gate', gateId: gate.id })} className="min-w-0 flex-1 text-left">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] uppercase tracking-[0.14em] text-dim">Gate {gateIndex + 1}</span>
                            <span className="text-[11px] text-dim">{gate.skills.length} {gate.skills.length === 1 ? 'skill' : 'skills'}</span>
                          </div>
                          <p className="mt-1 text-[13px] font-medium text-primary break-words">{gate.label || `Gate ${gateIndex + 1}`}</p>
                        </button>
                        <button type="button" onClick={() => handleDeleteGate(gate.id)} className="shrink-0 px-1 py-1 text-[12px] text-danger hover:underline">del</button>
                      </div>

                      <div
                        className={cx(
                          'mt-3 space-y-2 rounded-lg px-2 py-2',
                          gate.skills.length === 0 && 'border border-dashed border-border-subtle',
                          skillLaneDropActive && 'border border-dashed border-accent/50 bg-accent/5',
                        )}
                        onDragOver={(event) => {
                          if (dragItem?.kind !== 'skill') {
                            return;
                          }
                          event.preventDefault();
                          event.stopPropagation();
                          if (dropTarget?.kind !== 'skill' || dropTarget.gateId !== gate.id || dropTarget.skillId !== null) {
                            setDropTarget({ kind: 'skill', gateId: gate.id, skillId: null });
                          }
                        }}
                        onDrop={(event) => {
                          if (dragItem?.kind !== 'skill') {
                            return;
                          }
                          event.preventDefault();
                          event.stopPropagation();
                          handleDropSkill(gate.id, null);
                        }}
                      >
                        {gate.skills.length === 0 ? (
                          <p className="text-[11px] text-dim">Drop skills here.</p>
                        ) : gate.skills.map((skill) => {
                          const skillSelected = selection?.kind === 'skill' && selection.skillId === skill.id;
                          const skillDropActive = dragItem?.kind === 'skill'
                            && dropTarget?.kind === 'skill'
                            && dropTarget.gateId === gate.id
                            && dropTarget.skillId === skill.id;

                          return (
                            <div
                              key={skill.id}
                              className={cx(
                                'flex items-center gap-2 rounded-lg bg-base/70 px-2 py-2 transition-colors',
                                skillSelected && 'bg-accent/8',
                                skillDropActive && 'ring-1 ring-accent/50',
                              )}
                              onDragOver={(event) => {
                                if (dragItem?.kind !== 'skill') {
                                  return;
                                }
                                event.preventDefault();
                                event.stopPropagation();
                                if (dropTarget?.kind !== 'skill' || dropTarget.gateId !== gate.id || dropTarget.skillId !== skill.id) {
                                  setDropTarget({ kind: 'skill', gateId: gate.id, skillId: skill.id });
                                }
                              }}
                              onDrop={(event) => {
                                if (dragItem?.kind !== 'skill') {
                                  return;
                                }
                                event.preventDefault();
                                event.stopPropagation();
                                handleDropSkill(gate.id, skill.id);
                              }}
                            >
                              <div
                                draggable
                                onDragStart={() => setDragItem({ kind: 'skill', gateId: gate.id, skillId: skill.id })}
                                onDragEnd={clearDragState}
                                className={DRAG_HANDLE_CLASS}
                                aria-label={`Drag ${skill.label}`}
                                title="Drag skill"
                              >
                                ⋮⋮
                              </div>
                              <button type="button" onClick={() => setSelection({ kind: 'skill', gateId: gate.id, skillId: skill.id })} className="min-w-0 flex-1 text-left">
                                <p className="truncate text-[12px] font-medium text-primary">{skill.label}</p>
                                <p className="truncate text-[10px] text-dim">{skill.skillArgs ? `${skill.skillName} · ${skill.skillArgs}` : skill.skillName}</p>
                              </button>
                              <button type="button" onClick={() => handleDeleteSkill(gate.id, skill.id)} className="shrink-0 px-1 py-1 text-[12px] text-danger hover:underline">×</button>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <select
                          value={skillPickerValue}
                          onChange={(event) => {
                            const nextSkillName = event.target.value;
                            setSkillPickerByGateId((current) => ({ ...current, [gate.id]: nextSkillName }));
                          }}
                          className="min-w-[180px] flex-1 rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50"
                          disabled={skillNames.length === 0}
                        >
                          {data.skills.map((skill) => (
                            <option key={skill.name} value={skill.name}>{skill.name}</option>
                          ))}
                        </select>
                        <ToolbarButton onClick={() => handleAddSkill(gate.id, skillPickerValue)} disabled={skillNames.length === 0}>+ skill</ToolbarButton>
                      </div>
                    </div>
                  );
                })}

                <div
                  className={cx(
                    'rounded-lg border border-dashed border-border-subtle px-3 py-2 text-[11px] text-dim',
                    dragItem?.kind === 'gate' && dropTarget?.kind === 'gate' && dropTarget.gateId === null && 'border-accent/50 bg-accent/5 text-primary',
                  )}
                  onDragOver={(event) => {
                    if (dragItem?.kind !== 'gate') {
                      return;
                    }
                    event.preventDefault();
                    if (dropTarget?.kind !== 'gate' || dropTarget.gateId !== null) {
                      setDropTarget({ kind: 'gate', gateId: null });
                    }
                  }}
                  onDrop={(event) => {
                    if (dragItem?.kind !== 'gate') {
                      return;
                    }
                    event.preventDefault();
                    handleDropGate(null);
                  }}
                >
                  Drop gate at end
                </div>
              </div>
            )}
          </div>

          {!selection || !selectedGate ? (
            <div className="rounded-xl bg-surface/40 px-4 py-3 text-[12px] text-dim">Select a gate or skill to edit.</div>
          ) : selection.kind === 'gate' ? (
            <div className="space-y-3 border-t border-border-subtle pt-4">
              <div className="flex items-center justify-between gap-3">
                <p className="ui-section-label">Rule</p>
                <span className="text-[11px] text-dim">turn_end</span>
              </div>

              <input
                id="automation-gate-label"
                value={selectedGate.label}
                onChange={(event) => handleUpdateSelectedGate({ label: event.target.value })}
                className={INPUT_CLASS}
                placeholder="Rule label"
              />

              <div className="space-y-1.5">
                <label className="ui-section-label" htmlFor="automation-gate-prompt">When</label>
                <textarea
                  id="automation-gate-prompt"
                  value={selectedGate.prompt}
                  onChange={(event) => handleUpdateSelectedGate({ prompt: event.target.value })}
                  className={`${INPUT_CLASS} min-h-[96px] resize-y font-mono leading-relaxed`}
                  placeholder={'event:turn_end AND repo:personal-agent AND tool:edit AND prompt:"Did the assistant complete implementation of the feature?"'}
                  spellCheck={false}
                />
                <div className="space-y-1 rounded-lg bg-surface/50 px-3 py-2 text-[11px]">
                  <p className={cx('text-dim', filterValidation?.query === selectedGate.prompt.trim() && filterValidation.valid && !filterValidation.validating && 'text-success', filterValidation?.query === selectedGate.prompt.trim() && !filterValidation.valid && !filterValidation.validating && 'text-danger')}>
                    {filterValidation?.query === selectedGate.prompt.trim()
                      ? filterValidation.validating
                        ? 'Validating filter…'
                        : filterValidation.valid
                          ? 'Valid filter.'
                          : (filterValidation.error ?? 'Invalid filter.')
                      : 'Use AND, OR, and parentheses.'}
                  </p>
                  <p className="text-dim">Example: {data.filterHelp.examples[2] ?? data.filterHelp.examples[0]}</p>
                  <p className="text-dim">Only boolean operators and field:value clauses are supported right now. No wildcards, fuzzy search, or text-contains operators yet.</p>
                  <div className="space-y-1.5">
                    {data.filterHelp.fields.map((field) => (
                      <div key={field.key} className="rounded bg-base/70 px-2 py-2 text-[10px] leading-relaxed text-secondary">
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <span className="font-mono text-primary">{field.key}</span>
                          <span className="text-dim">· {field.valueHint}</span>
                        </div>
                        <p className="mt-1 text-dim">{field.description}</p>
                      </div>
                    ))}
                  </div>
                  {data.filterHelp.fields.find((field) => field.key === 'event')?.values?.length ? (
                    <p className="text-dim break-words">Events: {data.filterHelp.fields.find((field) => field.key === 'event')?.values?.join(', ')}</p>
                  ) : null}
                  {data.filterHelp.availableTools.length > 0 ? (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-dim">Available tools</p>
                      <div className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-base/70 px-2 py-2">
                        {data.filterHelp.availableTools.map((tool) => (
                          <div key={tool.name} className="grid grid-cols-[minmax(0,120px)_1fr] gap-x-2 gap-y-0.5 text-[10px] leading-relaxed">
                            <span className="font-mono text-primary break-all">{tool.name}</span>
                            <span className="text-dim">{tool.description || 'No description available.'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="ui-section-label" htmlFor="automation-gate-model">Judge model</label>
                {(modelsLoading && !modelState) ? (
                  <p className="text-[11px] text-dim">Loading available models…</p>
                ) : (!modelState && modelsError) ? (
                  <p className="text-[11px] text-danger">Failed to load models: {modelsError}</p>
                ) : modelState ? (
                  <>
                    <select
                      id="automation-gate-model"
                      value={data.judge.currentModel}
                      onChange={(event) => { void handleJudgeModelChange(event.target.value || ''); }}
                      disabled={savingJudgeModel || modelState.models.length === 0}
                      className={INPUT_CLASS}
                    >
                      <option value="">Use runtime default ({data.judge.effectiveModel})</option>
                      {groupedModels.map(([provider, models]) => (
                        <optgroup key={provider} label={provider}>
                          {models.map((model) => (
                            <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
                              {model.name} · {formatContextWindowLabel(model.context)} ctx
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <p className="text-[11px] text-dim">
                      {savingJudgeModel
                        ? 'Saving judge model…'
                        : data.judge.currentModel
                          ? `Pinned: ${formatModelSummary(selectedJudgeModel, data.judge.currentModel)}`
                          : `Default: ${formatModelSummary(effectiveJudgeModel, data.judge.effectiveModel)}`}
                    </p>
                  </>
                ) : null}
                {judgeModelError && <p className="text-[11px] text-danger">{judgeModelError}</p>}
              </div>
            </div>
          ) : selectedSkill ? (
            <div className="space-y-3 border-t border-border-subtle pt-4">
              <div className="flex items-center justify-between gap-3">
                <p className="ui-section-label">Skill</p>
                <span className="text-[11px] text-dim">Runs after the gate passes</span>
              </div>

              <input
                id="automation-skill-label"
                value={selectedSkill.label}
                onChange={(event) => handleUpdateSelectedSkill({ label: event.target.value })}
                className={INPUT_CLASS}
                placeholder="Skill label"
              />

              <div className="space-y-1.5">
                <select
                  id="automation-skill-name"
                  value={selectedSkill.skillName}
                  onChange={(event) => {
                    const skillName = event.target.value;
                    const selectedMeta = data.skills.find((skill) => skill.name === skillName);
                    handleUpdateSelectedSkill({
                      skillName,
                      label: selectedMeta?.name ?? selectedSkill.label,
                    });
                  }}
                  className={INPUT_CLASS}
                  disabled={skillNames.length === 0}
                >
                  {data.skills.map((skill) => (
                    <option key={skill.name} value={skill.name}>{skill.name} · {skill.source}</option>
                  ))}
                </select>
                {selectedSkillInfo?.description && <p className="text-[11px] text-dim break-words">{selectedSkillInfo.description}</p>}
              </div>

              <input
                id="automation-skill-args"
                value={selectedSkill.skillArgs ?? ''}
                onChange={(event) => handleUpdateSelectedSkill({ skillArgs: event.target.value })}
                className={INPUT_CLASS}
                placeholder="Optional args"
              />
            </div>
          ) : null}

          <p className="border-t border-border-subtle pt-4 text-[11px] text-dim">
            Judge prompt lives in <Link to="/settings" className="text-accent hover:underline">Settings</Link>.
          </p>

          {actionError && <p className="text-[11px] text-danger">{actionError}</p>}
        </div>
      </div>
    </div>
  );
}
