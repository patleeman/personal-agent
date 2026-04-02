import { useMemo, useState } from 'react';
import { api } from '../api';
import { useApi } from '../hooks';
import { ToolbarButton } from './ui';

export function NodeCaptureTriagePanel({
  nodeId,
  onChanged,
}: {
  nodeId: string;
  onChanged?: () => void;
}) {
  const detailApi = useApi(() => api.nodeDetail(nodeId), `node-capture:${nodeId}`);
  const [busy, setBusy] = useState<'promote' | 'ignore' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isCapture = useMemo(() => {
    const node = detailApi.data?.node;
    if (!node) {
      return false;
    }
    return node.status === 'inbox' || node.tags.some((tag) => tag.toLowerCase() === 'notetype:capture');
  }, [detailApi.data?.node]);

  if (!isCapture) {
    return null;
  }

  async function run(action: 'promote' | 'ignore') {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      await api.saveNodeDetail(nodeId, action === 'promote'
        ? { status: 'active', removeTags: ['noteType:capture'] }
        : { status: 'ignored' });
      await detailApi.refetch({ resetLoading: false });
      setNotice(action === 'promote' ? 'Capture promoted to a normal note.' : 'Capture marked ignored.');
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-secondary">
        This page is still an inbox capture. Triage it into a durable page, promote it into a tracked page, or ignore it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <ToolbarButton onClick={() => { void run('promote'); }} disabled={busy !== null} className="text-accent">
          {busy === 'promote' ? 'Promoting…' : 'Promote to page'}
        </ToolbarButton>
        <ToolbarButton onClick={() => { void run('ignore'); }} disabled={busy !== null}>
          {busy === 'ignore' ? 'Ignoring…' : 'Ignore capture'}
        </ToolbarButton>
      </div>
      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
      {!error && notice ? <p className="text-[12px] text-secondary">{notice}</p> : null}
    </div>
  );
}
