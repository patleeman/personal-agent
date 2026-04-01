import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useApi } from '../hooks';
import { emitMemoriesChanged } from '../memoryDocEvents';
import { emitProjectsChanged } from '../projectEvents';
import { ToolbarButton } from './ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

function parseTagLines(value: string): string[] {
  return [...new Set(value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0))]
    .sort((left, right) => left.localeCompare(right));
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
  const [tagsText, setTagsText] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!node) {
      return;
    }

    setTitle(node.title);
    setSummary(node.summary);
    setDescription(node.description ?? '');
    setStatus(node.status);
    setParent(node.parent ?? '');
    setTagsText(node.tags.filter((tag) => !/^parent:/i.test(tag) && !/^status:/i.test(tag)).join('\n'));
    setSaveError(null);
    setSaveNotice(null);
  }, [node]);

  const parsedTags = useMemo(() => parseTagLines(tagsText), [tagsText]);
  const savedTags = useMemo(
    () => node
      ? node.tags
        .filter((tag) => !/^parent:/i.test(tag) && !/^status:/i.test(tag))
        .sort((left, right) => left.localeCompare(right))
      : [],
    [node],
  );
  const dirty = Boolean(node) && (
    title !== node.title
    || summary !== node.summary
    || description !== (node.description ?? '')
    || status !== node.status
    || parent !== (node.parent ?? '')
    || !sameStringArray(parsedTags, savedTags)
  );

  async function handleSave() {
    if (!node || !dirty || saveBusy) {
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
      setSaveNotice('Saved node metadata.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaveBusy(false);
    }
  }

  if (!node) {
    return <p className="text-[12px] text-dim">Loading node metadata…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3">
        <div className="grid gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">Node id</span>
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
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className={`${INPUT_CLASS} resize-y`} placeholder="Optional guidance for when to use this node." />
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
          <input value={parent} onChange={(event) => setParent(event.target.value)} className={`${INPUT_CLASS} font-mono`} placeholder="Optional parent node id" spellCheck={false} />
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">Tags</span>
          <textarea value={tagsText} onChange={(event) => setTagsText(event.target.value)} rows={6} className={`${INPUT_CLASS} resize-y font-mono`} placeholder="One tag per line" spellCheck={false} />
          {(nodesApi.data?.tagKeys?.length ?? 0) > 0 ? (
            <p className="text-[11px] text-dim">Known tag keys: {(nodesApi.data?.tagKeys ?? []).join(', ')}</p>
          ) : null}
        </label>
      </div>

      <div className="flex items-center gap-2">
        <ToolbarButton onClick={() => { void handleSave(); }} disabled={!dirty || saveBusy} className="text-accent">
          {saveBusy ? 'Saving…' : 'Save metadata'}
        </ToolbarButton>
        {saveNotice ? <span className="text-[12px] text-secondary">{saveNotice}</span> : null}
      </div>
      {saveError ? <p className="text-[12px] text-danger">{saveError}</p> : null}
    </div>
  );
}
