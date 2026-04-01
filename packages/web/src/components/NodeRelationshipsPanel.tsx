import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { buildNodesHref } from '../nodeWorkspaceState';
import { ToolbarButton } from './ui';

const TYPE_OPTIONS = [
  'related',
  'depends-on',
  'blocks',
  'implements',
  'references',
  'derived-from',
  'uses',
] as const;

function normalizeRelationships(input: Array<{ type: string; targetId: string }>): Array<{ type: string; targetId: string }> {
  const seen = new Set<string>();
  const normalized: Array<{ type: string; targetId: string }> = [];

  for (const entry of input) {
    const type = entry.type.trim().toLowerCase();
    const targetId = entry.targetId.trim().toLowerCase();
    if (!type || !targetId) {
      continue;
    }

    const key = `${type}:${targetId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({ type, targetId });
  }

  return normalized.sort((left, right) => left.type.localeCompare(right.type) || left.targetId.localeCompare(right.targetId));
}

function sameRelationships(
  left: Array<{ type: string; targetId: string }>,
  right: Array<{ type: string; targetId: string }>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => entry.type === right[index]?.type && entry.targetId === right[index]?.targetId);
}

function relationshipTypeLabel(value: string): string {
  return value.replace(/-/g, ' ');
}

export function NodeRelationshipsPanel({
  nodeId,
  emptyOutgoingText,
  emptyIncomingText,
  onChanged,
}: {
  nodeId: string;
  emptyOutgoingText: string;
  emptyIncomingText: string;
  onChanged?: () => void;
}) {
  const detailApi = useApi(() => api.nodeDetail(nodeId), `node-detail:${nodeId}`);
  const nodesApi = useApi(api.nodes, 'node-detail-options');
  const [draftRelationships, setDraftRelationships] = useState<Array<{ type: string; targetId: string }>>([]);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const savedRelationships = useMemo(
    () => normalizeRelationships((detailApi.data?.outgoingRelationships ?? []).map((relationship) => ({
      type: relationship.type,
      targetId: relationship.node.id,
    }))),
    [detailApi.data?.outgoingRelationships],
  );
  const allNodeOptions = useMemo(() => {
    return (nodesApi.data?.nodes ?? [])
      .filter((node) => node.id !== nodeId)
      .map((node) => ({ id: node.id, title: node.title, kind: node.kind }))
      .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  }, [nodeId, nodesApi.data?.nodes]);
  const dirty = useMemo(() => !sameRelationships(savedRelationships, normalizeRelationships(draftRelationships)), [draftRelationships, savedRelationships]);

  useEffect(() => {
    setDraftRelationships(savedRelationships);
  }, [savedRelationships]);

  async function saveRelationships() {
    setSaveBusy(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      await api.saveNodeDetail(nodeId, {
        relationships: normalizeRelationships(draftRelationships),
      });
      await detailApi.refetch({ resetLoading: false });
      setSaveNotice('Saved relationships.');
      onChanged?.();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">Typed links</p>
          <div className="flex items-center gap-2">
            <ToolbarButton
              onClick={() => setDraftRelationships((current) => [...current, { type: 'related', targetId: '' }])}
            >
              Add link
            </ToolbarButton>
            <ToolbarButton onClick={() => { void saveRelationships(); }} disabled={!dirty || saveBusy} className="text-accent">
              {saveBusy ? 'Saving…' : 'Save'}
            </ToolbarButton>
          </div>
        </div>
        {draftRelationships.length === 0 ? (
          <p className="text-[12px] text-dim">{emptyOutgoingText}</p>
        ) : (
          <div className="space-y-2">
            {draftRelationships.map((relationship, index) => {
              const datalistId = `node-relationship-options-${nodeId}-${index}`;
              return (
                <div key={`${index}:${relationship.type}:${relationship.targetId}`} className="flex items-center gap-2">
                  <select
                    aria-label={`Relationship type ${index + 1}`}
                    value={relationship.type}
                    onChange={(event) => {
                      const next = [...draftRelationships];
                      next[index] = { ...next[index], type: event.target.value };
                      setDraftRelationships(next);
                      setSaveNotice(null);
                    }}
                    className="w-[8.5rem] rounded-lg border border-border-default bg-base px-2 py-2 text-[12px] text-primary"
                  >
                    {TYPE_OPTIONS.map((value) => (
                      <option key={value} value={value}>{relationshipTypeLabel(value)}</option>
                    ))}
                  </select>
                  <input
                    list={datalistId}
                    value={relationship.targetId}
                    onChange={(event) => {
                      const next = [...draftRelationships];
                      next[index] = { ...next[index], targetId: event.target.value };
                      setDraftRelationships(next);
                      setSaveNotice(null);
                    }}
                    placeholder="target node id"
                    aria-label={`Relationship target ${index + 1}`}
                    className="flex-1 rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] font-mono text-primary"
                    spellCheck={false}
                  />
                  <datalist id={datalistId}>
                    {allNodeOptions.map((option) => (
                      <option key={option.id} value={option.id}>{`${option.title} (${option.kind})`}</option>
                    ))}
                  </datalist>
                  <button
                    type="button"
                    onClick={() => {
                      setDraftRelationships((current) => current.filter((_, rowIndex) => rowIndex !== index));
                      setSaveNotice(null);
                    }}
                    className="text-[12px] text-dim transition-colors hover:text-danger"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {saveError ? <p className="text-[12px] text-danger">{saveError}</p> : null}
        {!saveError && saveNotice ? <p className="text-[12px] text-secondary">{saveNotice}</p> : null}
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">Linked from</p>
        {(detailApi.data?.incomingRelationships ?? []).length === 0 ? (
          <p className="text-[12px] text-dim">{emptyIncomingText}</p>
        ) : (
          <div className="space-y-1.5">
            {detailApi.data?.incomingRelationships.map((relationship) => (
              <div key={`${relationship.type}:${relationship.node.kind}:${relationship.node.id}`} className="text-[12px] leading-relaxed text-secondary">
                <span className="text-dim">{relationshipTypeLabel(relationship.type)}</span>
                <span className="mx-1.5 opacity-40">·</span>
                <Link to={buildNodesHref(relationship.node.kind, relationship.node.id)} className="text-primary hover:underline">
                  {relationship.node.title}
                </Link>
                <span className="ml-1 font-mono text-dim">@{relationship.node.id}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {(detailApi.data?.suggestedNodes ?? []).length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">Suggested</p>
          <div className="space-y-2">
            {detailApi.data?.suggestedNodes.map((suggestion) => (
              <div key={`${suggestion.node.kind}:${suggestion.node.id}`} className="rounded-lg border border-border-subtle px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link to={buildNodesHref(suggestion.node.kind, suggestion.node.id)} className="truncate text-[13px] font-medium text-primary hover:underline">
                        {suggestion.node.title}
                      </Link>
                      <span className="font-mono text-[11px] text-dim">@{suggestion.node.id}</span>
                    </div>
                    {suggestion.node.summary ? <p className="mt-1 text-[12px] text-secondary">{suggestion.node.summary}</p> : null}
                    <p className="mt-1 text-[11px] text-dim">{suggestion.reasons.join(' · ')}</p>
                  </div>
                  <ToolbarButton
                    onClick={() => {
                      setDraftRelationships((current) => normalizeRelationships([...current, { type: 'related', targetId: suggestion.node.id }]));
                      setSaveNotice(null);
                    }}
                  >
                    Add
                  </ToolbarButton>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
