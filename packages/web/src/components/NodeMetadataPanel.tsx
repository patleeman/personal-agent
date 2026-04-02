import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApi } from '../hooks';
import { emitMemoriesChanged } from '../memoryDocEvents';
import { emitProjectsChanged } from '../projectEvents';
import { ToolbarButton } from './ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

type TagRow = {
  key: string;
  value: string;
};

function isTagKey(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !trimmed.includes(':');
}

function splitTag(tag: string): TagRow {
  const separator = tag.indexOf(':');
  if (separator <= 0 || separator >= tag.length - 1) {
    return { key: tag.trim(), value: '' };
  }
  return {
    key: tag.slice(0, separator).trim(),
    value: tag.slice(separator + 1).trim(),
  };
}

function normalizeTagRows(rows: TagRow[]): string[] {
  return [...new Set(rows
    .map((row) => ({ key: row.key.trim(), value: row.value.trim() }))
    .filter((row) => isTagKey(row.key) && row.value.length > 0)
    .map((row) => `${row.key}:${row.value}`))]
    .sort((left, right) => left.localeCompare(right));
}

function invalidTagLabels(rows: TagRow[]): string[] {
  return rows
    .map((row) => ({ key: row.key.trim(), value: row.value.trim() }))
    .filter((row) => row.key.length > 0 || row.value.length > 0)
    .filter((row) => !isTagKey(row.key) || row.value.length === 0)
    .map((row) => row.key.length > 0 ? row.key : '(missing key)');
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

export function NodeMetadataPanel({
  nodeId,
  onChanged,
  showTitle = true,
  showSummary = true,
  showDescription = true,
  showStatus = true,
}: {
  nodeId: string;
  onChanged?: () => void;
  showTitle?: boolean;
  showSummary?: boolean;
  showDescription?: boolean;
  showStatus?: boolean;
}) {
  const detailApi = useApi(() => api.nodeDetail(nodeId), `node-metadata:${nodeId}`);
  const nodesApi = useApi(api.nodes, 'node-metadata-options');
  const node = detailApi.data?.node ?? null;
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('active');
  const [parent, setParent] = useState('');
  const [tagRows, setTagRows] = useState<TagRow[]>([]);
  const [draftTagKey, setDraftTagKey] = useState('');
  const [draftTagValue, setDraftTagValue] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!node) {
      return;
    }

    const editableTags = node.tags.filter((tag) => !/^parent:/i.test(tag) && !/^status:/i.test(tag));
    setTitle(node.title);
    setSummary(node.summary);
    setDescription(node.description ?? '');
    setStatus(node.status);
    setParent(node.parent ?? '');
    setTagRows(editableTags.map(splitTag));
    setDraftTagKey('');
    setDraftTagValue('');
    setSaveError(null);
    setSaveNotice(null);
  }, [node]);

  const parsedTags = useMemo(() => normalizeTagRows(tagRows), [tagRows]);
  const invalidTags = useMemo(() => invalidTagLabels(tagRows), [tagRows]);
  const savedTags = useMemo(
    () => node
      ? node.tags
        .filter((tag) => !/^parent:/i.test(tag) && !/^status:/i.test(tag))
        .sort((left, right) => left.localeCompare(right))
      : [],
    [node],
  );
  const draftTagValid = isTagKey(draftTagKey) && draftTagValue.trim().length > 0;
  const dirty = Boolean(node) && (
    title !== node.title
    || summary !== node.summary
    || description !== (node.description ?? '')
    || status !== node.status
    || parent !== (node.parent ?? '')
    || !sameStringArray(parsedTags, savedTags)
  );
  const canSave = dirty && !saveBusy && invalidTags.length === 0;
  const knownTagKeys = nodesApi.data?.tagKeys ?? [];
  const tagKeyListId = `node-tag-keys-${nodeId}`;

  function updateTagRow(index: number, field: keyof TagRow, value: string) {
    setTagRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
    setSaveError(null);
    setSaveNotice(null);
  }

  function removeTagRow(index: number) {
    setTagRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
    setSaveError(null);
    setSaveNotice(null);
  }

  function addDraftTag() {
    if (!draftTagValid) {
      return;
    }

    setTagRows((current) => [...current, { key: draftTagKey.trim(), value: draftTagValue.trim() }]);
    setDraftTagKey('');
    setDraftTagValue('');
    setSaveError(null);
    setSaveNotice(null);
  }

  async function handleSave() {
    if (!node || !dirty || saveBusy) {
      return;
    }

    if (invalidTags.length > 0) {
      setSaveError(`Tags must use key:value format. Invalid tags: ${invalidTags.join(', ')}`);
      return;
    }

    setSaveBusy(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      await api.saveNodeDetail(node.id, {
        ...(showTitle ? { title } : {}),
        ...(showSummary ? { summary } : {}),
        ...(showDescription ? { description } : {}),
        ...(showStatus ? { status } : {}),
        parent: parent.trim() || null,
        tags: parsedTags,
      });
      await detailApi.refetch({ resetLoading: false });
      if (node.kind === 'note' || node.kind === 'skill') {
        emitMemoriesChanged();
      }
      if (node.kind === 'project') {
        emitProjectsChanged();
      }
      onChanged?.();
      setSaveNotice('Saved page metadata.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaveBusy(false);
    }
  }

  if (!node) {
    return <p className="text-[12px] text-dim">Loading page metadata…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3">
        <div className="grid gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">Page id</span>
          <div className="font-mono text-[12px] text-secondary">@{node.id}</div>
        </div>
        <div className="grid gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">Kinds</span>
          <div className="text-[12px] text-secondary">{node.kinds.join(', ')}</div>
        </div>
        {showTitle ? (
          <label className="grid gap-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} className={INPUT_CLASS} />
          </label>
        ) : null}
        {showSummary ? (
          <label className="grid gap-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">Summary</span>
            <textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={3} className={`${INPUT_CLASS} resize-y`} />
          </label>
        ) : null}
        {showDescription ? (
          <label className="grid gap-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">Description</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className={`${INPUT_CLASS} resize-y`} placeholder="Optional guidance for when to use this page." />
          </label>
        ) : null}
        {showStatus ? (
          <label className="grid gap-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">Status</span>
            <input value={status} onChange={(event) => setStatus(event.target.value)} className={INPUT_CLASS} />
          </label>
        ) : null}
        <label className="grid gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">Parent</span>
          <input value={parent} onChange={(event) => setParent(event.target.value)} className={`${INPUT_CLASS} font-mono`} placeholder="Optional parent page id" spellCheck={false} />
        </label>
        <div className="grid gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">Tags</span>
          <p className="text-[11px] text-dim">Use `key:value` tags like `area:web-ui` or `topic:checkpoint`.</p>
          <datalist id={tagKeyListId}>
            {knownTagKeys.map((key) => (
              <option key={key} value={key} />
            ))}
          </datalist>
          <div className="space-y-2">
            {tagRows.length > 0 ? tagRows.map((row, index) => (
              <div key={`tag-row-${index}`} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] gap-2">
                <input
                  value={row.key}
                  onChange={(event) => updateTagRow(index, 'key', event.target.value)}
                  className={`${INPUT_CLASS} font-mono`}
                  placeholder="key"
                  list={tagKeyListId}
                  spellCheck={false}
                />
                <input
                  value={row.value}
                  onChange={(event) => updateTagRow(index, 'value', event.target.value)}
                  className={`${INPUT_CLASS} font-mono`}
                  placeholder="value"
                  spellCheck={false}
                />
                <ToolbarButton onClick={() => removeTagRow(index)} className="shrink-0">Remove</ToolbarButton>
              </div>
            )) : (
              <p className="text-[12px] text-dim">No custom tags yet.</p>
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] gap-2">
            <input
              value={draftTagKey}
              onChange={(event) => setDraftTagKey(event.target.value)}
              className={`${INPUT_CLASS} font-mono`}
              placeholder="key"
              list={tagKeyListId}
              spellCheck={false}
            />
            <input
              value={draftTagValue}
              onChange={(event) => setDraftTagValue(event.target.value)}
              className={`${INPUT_CLASS} font-mono`}
              placeholder="value"
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && draftTagValid) {
                  event.preventDefault();
                  addDraftTag();
                }
              }}
            />
            <ToolbarButton onClick={addDraftTag} disabled={!draftTagValid} className="shrink-0 text-accent">Add tag</ToolbarButton>
          </div>
          {invalidTags.length > 0 ? (
            <p className="text-[11px] text-danger">Each tag needs both a key and value. Fix: {invalidTags.join(', ')}</p>
          ) : null}
          {knownTagKeys.length > 0 ? (
            <p className="text-[11px] text-dim">Known tag keys: {knownTagKeys.join(', ')}</p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <ToolbarButton onClick={() => { void handleSave(); }} disabled={!canSave} className="text-accent">
          {saveBusy ? 'Saving…' : 'Save metadata'}
        </ToolbarButton>
        {saveNotice ? <span className="text-[12px] text-secondary">{saveNotice}</span> : null}
      </div>
      {saveError ? <p className="text-[12px] text-danger">{saveError}</p> : null}
    </div>
  );
}
