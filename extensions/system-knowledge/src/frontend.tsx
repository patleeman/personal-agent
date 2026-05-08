import {
  type MemoryDocItem,
  type MentionItem,
  navigateKnowledgeFile,
  VaultEditor,
  type VaultFileSummary,
  VaultFileTree,
} from '@personal-agent/extensions/data';
import { type ExtensionSurfaceProps, lazyRouteWithRecovery } from '@personal-agent/extensions/ui';
import { Suspense, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const LazyVaultFileTree = lazyRouteWithRecovery('system-knowledge-vault-file-tree', async () => ({ default: VaultFileTree }));

function getKnowledgeFileId(search: string): string | null {
  return new URLSearchParams(search).get('file');
}

export function KnowledgeTreePanel({ pa }: ExtensionSurfaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFileId = getKnowledgeFileId(searchParams.toString());
  const handleFileSelect = useCallback(
    (id: string) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('artifact');
        next.delete('checkpoint');
        next.delete('run');
        next.delete('workspaceFile');
        next.set('file', id);
        return next;
      });
    },
    [setSearchParams],
  );

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <Suspense fallback={<div className="flex h-full items-center justify-center px-4 text-[12px] text-dim">Loading…</div>}>
        <LazyVaultFileTree
          activeFileId={activeFileId}
          onFileSelect={handleFileSelect}
          onSyncKnowledgeBase={() => pa.extension.invoke('sync', {})}
        />
      </Suspense>
    </div>
  );
}

export function KnowledgeFilePanel({ context }: ExtensionSurfaceProps) {
  const [, setSearchParams] = useSearchParams();
  const activeFileId = getKnowledgeFileId(context.search);
  const fileName = activeFileId ? activeFileId.split('/').filter(Boolean).pop() : undefined;
  const handleFileNavigate = useCallback(
    (id: string) => {
      navigateKnowledgeFile(setSearchParams, id);
    },
    [setSearchParams],
  );
  const handleFileRenamed = useCallback(
    (oldId: string, newId: string) => {
      if (activeFileId === oldId) {
        navigateKnowledgeFile(setSearchParams, newId, { replace: true });
      }
    },
    [activeFileId, setSearchParams],
  );

  if (!activeFileId) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center select-text">
        <div className="max-w-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-steel/80">Workbench</p>
          <h2 className="mt-2 text-lg font-semibold text-primary text-balance">Open a knowledge file</h2>
          <p className="mt-2 text-[13px] leading-6 text-secondary">Pick a file from the right rail to keep it beside the transcript.</p>
        </div>
      </div>
    );
  }

  return <VaultEditor fileId={activeFileId} fileName={fileName} onFileNavigate={handleFileNavigate} onFileRenamed={handleFileRenamed} />;
}

export function buildKnowledgeMentionItems(input: { memoryDocs: MemoryDocItem[]; vaultFiles: VaultFileSummary[] }): MentionItem[] {
  return [
    ...input.memoryDocs.map((doc) => ({
      id: `@${doc.id}`,
      label: doc.id,
      kind: 'note' as const,
      title: doc.title,
      summary: doc.summary,
      path: doc.path,
    })),
    ...input.vaultFiles.map((file) => ({
      id: `@${file.id}`,
      label: file.id,
      kind: (file.kind === 'folder' ? 'folder' : 'file') as const,
      title: file.name,
      summary: file.path,
      path: file.path,
    })),
  ];
}
