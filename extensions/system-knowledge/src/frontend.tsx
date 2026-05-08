import { type MemoryDocItem, type MentionItem } from '@personal-agent/extensions/data';
import {
  AppPageEmptyState,
  AppPageIntro,
  AppPageLayout,
  type ExtensionSurfaceProps,
  lazyRouteWithRecovery,
  useApi,
} from '@personal-agent/extensions/ui';
import { Suspense, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { VaultEditor } from './components/VaultEditor';
import { VaultFileTree } from './components/VaultFileTree';
import { knowledgeApi } from './lib/knowledgeApi';
import { navigateKnowledgeFile } from './lib/knowledgeNavigation';

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

export function KnowledgePageSurface() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFileId = searchParams.get('file') ?? null;
  const { data: knowledgeBaseState, loading: knowledgeBaseLoading } = useApi(knowledgeApi.state, 'knowledge-page-knowledge-base');
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

  const fileName = activeFileId ? activeFileId.split('/').filter(Boolean).pop() : undefined;

  if (knowledgeBaseLoading && !knowledgeBaseState) {
    return (
      <div className="h-full overflow-y-auto">
        <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="max-w-[72rem] flex min-h-full flex-col gap-10">
          <AppPageIntro title="Knowledge" />
          <AppPageEmptyState align="start" title="Loading knowledge base…" body="Checking whether managed sync is enabled." />
        </AppPageLayout>
      </div>
    );
  }

  if (knowledgeBaseState?.configured === false) {
    return (
      <div className="h-full overflow-y-auto">
        <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="max-w-[72rem] flex min-h-full flex-col gap-10">
          <AppPageIntro title="Knowledge" />
          <AppPageEmptyState
            align="start"
            title="Connect a git repo to start using Knowledge"
            body={
              <div className="space-y-3 leading-6">
                <p>
                  Knowledge stores durable docs, skills, and instruction files in a git repository. PA clones the repo, watches for local
                  edits, and syncs changes automatically.
                </p>
                <div className="rounded-2xl border border-border-subtle bg-surface px-4 py-3">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-dim">Setup</p>
                  <ol className="ml-4 list-decimal space-y-1.5 text-[13px]">
                    <li>Create a git repository. It can be empty or already have content.</li>
                    <li>
                      Copy the clone URL — HTTPS format like{' '}
                      <code className="rounded bg-elevated px-1 py-0.5 font-mono text-[12px]">
                        https://github.com/you/knowledge-base.git
                      </code>
                    </li>
                    <li>Paste it in Settings and PA will clone and manage the rest.</li>
                  </ol>
                </div>
                <p className="text-[12px] text-dim">Private repos work too — PA uses git credential helpers from the environment.</p>
              </div>
            }
            action={
              <Link to="/settings#settings-general" className="ui-toolbar-button">
                Open Settings
              </Link>
            }
          />
        </AppPageLayout>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden">
      <div className="w-[19rem] shrink-0 border-r border-border-subtle bg-surface/30">
        <VaultFileTree activeFileId={activeFileId} onFileSelect={handleFileNavigate} />
      </div>
      <div className="min-w-0 flex-1">
        {activeFileId ? (
          <VaultEditor fileId={activeFileId} fileName={fileName} onFileNavigate={handleFileNavigate} onFileRenamed={handleFileRenamed} />
        ) : (
          <div className="h-full overflow-y-auto">
            <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="max-w-[72rem] flex min-h-full flex-col gap-10">
              <AppPageIntro title="Knowledge" />
              <AppPageEmptyState
                align="start"
                title="Select a file to start editing"
                body="Pick a note from the knowledge file list, or import a URL into the knowledge base."
              />
            </AppPageLayout>
          </div>
        )}
      </div>
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

function quickOpenFileTitle(name: string): string {
  return name.replace(/\.md$/i, '');
}

function quickOpenFileLocation(id: string): string | undefined {
  const parts = id.split('/').slice(0, -1).filter(Boolean);
  return parts.length > 0 ? parts.join('/') : undefined;
}

function quickOpenExcerpt(value: string | undefined, maxLength = 140): string | undefined {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

export const knowledgeQuickOpenProvider = {
  async list() {
    const result = await knowledgeApi.listFiles();
    return result.files
      .filter((file) => file.kind === 'file' && file.name.endsWith('.md'))
      .map((file, index) => ({
        id: `knowledge-file:${file.id}`,
        section: 'files',
        title: quickOpenFileTitle(file.name),
        subtitle: quickOpenFileLocation(file.id),
        meta: file.id,
        keywords: [file.id, file.name, file.path],
        order: index,
        action: { kind: 'openFile', fileId: file.id },
      }));
  },
  async search(query: string, limit: number) {
    const result = await knowledgeApi.search(query, limit);
    return result.results.map((file, index) => ({
      id: `knowledge-file-search:${file.id}`,
      section: 'files',
      title: quickOpenFileTitle(file.name),
      subtitle: quickOpenFileLocation(file.id),
      meta: quickOpenExcerpt(file.excerpt) ?? file.id,
      keywords: [file.id, file.name, file.excerpt],
      order: index,
      action: { kind: 'openFile', fileId: file.id },
    }));
  },
};

export async function buildKnowledgeMentionItems(input: { memoryDocs: MemoryDocItem[] }): Promise<MentionItem[]> {
  const vaultFiles = await knowledgeApi.listFiles();
  return [
    ...input.memoryDocs.map((doc) => ({
      id: `@${doc.id}`,
      label: doc.id,
      kind: 'note' as const,
      title: doc.title,
      summary: doc.summary,
      path: doc.path,
    })),
    ...vaultFiles.files.map((file) => ({
      id: `@${file.id}`,
      label: file.id,
      kind: (file.kind === 'folder' ? 'folder' : 'file') as const,
      title: file.name,
      summary: file.path,
      path: file.path,
    })),
  ];
}
