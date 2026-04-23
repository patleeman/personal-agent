import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { VaultEditor } from '../components/knowledge/VaultEditor';
import { AppPageEmptyState, AppPageIntro, AppPageLayout } from '../components/ui';
import { navigateKnowledgeFile } from '../knowledge/knowledgeNavigation';

export function KnowledgePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFileId = searchParams.get('file') ?? null;
  const handleFileNavigate = useCallback((id: string) => {
    navigateKnowledgeFile(setSearchParams, id);
  }, [setSearchParams]);

  const handleFileRenamed = useCallback((oldId: string, newId: string) => {
    if (activeFileId === oldId) {
      navigateKnowledgeFile(setSearchParams, newId, { replace: true });
    }
  }, [activeFileId, setSearchParams]);

  const fileName = activeFileId
    ? activeFileId.split('/').filter(Boolean).pop()
    : undefined;

  if (!activeFileId) {
    return (
      <div className="h-full overflow-y-auto">
        <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="max-w-[72rem] flex min-h-full flex-col gap-10">
          <AppPageIntro
            title="Knowledge"
            summary="Edit durable files under the indexed knowledge root and move between notes from the sidebar."
          />
          <AppPageEmptyState
            align="start"
            title="Select a file to start editing"
            body="Pick a note from the sidebar, or import a URL into the knowledge base."
          />
        </AppPageLayout>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 min-w-0">
      <VaultEditor
        fileId={activeFileId}
        fileName={fileName}
        onFileNavigate={handleFileNavigate}
        onFileRenamed={handleFileRenamed}
        key={activeFileId ?? '__empty'}
      />
    </div>
  );
}
