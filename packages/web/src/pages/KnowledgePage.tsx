import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { VaultEditor } from '../components/knowledge/VaultEditor';
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
