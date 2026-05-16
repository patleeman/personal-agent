import './components/knowledge.css';

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
import { useSearchParams } from 'react-router-dom';

import { KnowledgeSettingsPanel as KnowledgeSettingsPanelComponent } from './components/KnowledgeSettingsPanel';
import { VaultEditor } from './components/VaultEditor';
import { VaultFileTree } from './components/VaultFileTree';
import { knowledgeApi } from './lib/knowledgeApi';
import { navigateKnowledgeFile } from './lib/knowledgeNavigation';

const LazyVaultFileTree = lazyRouteWithRecovery('system-knowledge-vault-file-tree', async () => ({ default: VaultFileTree }));

function getKnowledgeFileId(search: string): string | null {
  return new URLSearchParams(search).get('file');
}

async function readKnowledgeBaseResponse<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = (await response.json()) as { ok?: boolean; result?: T; error?: string } | T;
  if (!response.ok || (payload && typeof payload === 'object' && 'ok' in payload && payload.ok === false)) {
    throw new Error((payload as { error?: string }).error ?? `Knowledge base request failed: ${response.status}`);
  }
  if (payload && typeof payload === 'object' && 'result' in payload) {
    return (payload as { result: T }).result;
  }
  return payload as T;
}

export function KnowledgeSettingsPanel() {
  return (
    <KnowledgeSettingsPanelComponent
      apiClient={{
        state: () => readKnowledgeBaseResponse('/api/knowledge-base'),
        updateState: (input) =>
          readKnowledgeBaseResponse('/api/knowledge-base', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
          }),
        sync: () => readKnowledgeBaseResponse('/api/knowledge-base/sync', { method: 'POST' }),
      }}
    />
  );
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
    <div className="h-full min-h-0 overflow-hidden">
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
        <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="flex min-h-full flex-col gap-10">
          <AppPageIntro title="Knowledge" summary="Durable notes, skills, and project context for the agent." />
          <AppPageEmptyState align="start" title="Loading knowledge base…" body="Checking whether managed sync is enabled." />
        </AppPageLayout>
      </div>
    );
  }

  if (knowledgeBaseState?.configured === false) {
    return (
      <div className="h-full overflow-y-auto">
        <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="flex min-h-full flex-col gap-10">
          <AppPageIntro title="Knowledge" summary="Durable notes, skills, and project context for the agent." />
          <section className="mx-auto flex w-full max-w-3xl flex-col gap-7 pt-[12vh] text-left">
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-steel/80">Set Up Knowledge</p>
              <h2 className="text-3xl font-semibold tracking-[-0.03em] text-primary text-balance">Give the agent a durable memory.</h2>
              <p className="max-w-2xl text-[14px] leading-7 text-secondary">
                Knowledge is a git-backed folder for notes, skills, project context, and instructions. PA clones the repo locally, watches
                for edits, and syncs changes in the background. Less ceremony, more brain.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border border-border-subtle bg-elevated/60 p-5 shadow-sm">
                <KnowledgeSettingsPanelComponent variant="onboarding" />
              </div>
              <div className="space-y-4 py-1 text-[13px] leading-6 text-secondary">
                <div>
                  <h3 className="text-[13px] font-semibold text-primary">What Goes In Here</h3>
                  <p className="mt-1">Reusable skills, durable notes, project docs, and instructions the agent should actually remember.</p>
                </div>
                <div>
                  <h3 className="text-[13px] font-semibold text-primary">How Sync Works</h3>
                  <p className="mt-1">
                    Git is the backing store. PA keeps a local mirror under runtime state and reads files from that mirror.
                  </p>
                </div>
                <div>
                  <h3 className="text-[13px] font-semibold text-primary">Already Have One?</h3>
                  <p className="mt-1">Paste the clone URL. Empty repo is fine too — PA will populate it as you build memory.</p>
                </div>
              </div>
            </div>
          </section>
        </AppPageLayout>
      </div>
    );
  }

  if (activeFileId) {
    return <VaultEditor fileId={activeFileId} fileName={fileName} onFileNavigate={handleFileNavigate} onFileRenamed={handleFileRenamed} />;
  }

  return (
    <div className="h-full overflow-y-auto">
      <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="flex min-h-full flex-col gap-10">
        <AppPageIntro title="Knowledge" summary="Durable notes, skills, and project context for the agent." />
        <AppPageEmptyState
          align="start"
          title="Select a file to start editing"
          body="Pick a note from the right sidebar, or import a URL into the knowledge base."
        />
      </AppPageLayout>
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
