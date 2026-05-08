import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { ExtensionSurfaceProps } from '@personal-agent/extensions';
import {
  ArtifactToolBlock,
  ConversationArtifactRailContent,
  ConversationArtifactWorkbenchPane,
  readArtifactPresentation,
  setConversationArtifactIdInSearch,
  useConversationArtifactSummaries,
} from '@personal-agent/extensions/workbench';

export function ArtifactTranscriptRenderer({
  block,
  context,
}: {
  block: Parameters<typeof readArtifactPresentation>[0];
  context: { onOpenArtifact?: (artifactId: string) => void; activeArtifactId?: string | null };
}) {
  const artifact = readArtifactPresentation(block);
  if (!artifact) return null;
  return (
    <ArtifactToolBlock
      block={block}
      artifact={artifact}
      onOpenArtifact={context.onOpenArtifact}
      activeArtifactId={context.activeArtifactId}
    />
  );
}

export function ArtifactsPanel({ context }: ExtensionSurfaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { artifacts, loading, error } = useConversationArtifactSummaries(context.conversationId ?? null);
  const activeArtifactId = searchParams.get('artifact') ?? null;
  const handleOpenArtifact = useCallback(
    (artifactId: string) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('file');
        next.delete('checkpoint');
        next.delete('run');
        return new URLSearchParams(setConversationArtifactIdInSearch(next.toString(), artifactId));
      });
    },
    [setSearchParams],
  );

  return (
    <ConversationArtifactRailContent
      artifacts={artifacts}
      activeArtifactId={activeArtifactId}
      loading={loading}
      error={error}
      onOpenArtifact={handleOpenArtifact}
    />
  );
}

export function ArtifactDetailPanel({ context }: ExtensionSurfaceProps) {
  const artifactId = new URLSearchParams(context.search).get('artifact');

  if (!context.conversationId || !artifactId) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center select-text">
        <div className="max-w-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-steel/80">Workbench</p>
          <h2 className="mt-2 text-lg font-semibold text-primary text-balance">Open an artifact</h2>
          <p className="mt-2 text-[13px] leading-6 text-secondary">
            Pick an artifact from the right rail to inspect it beside the transcript.
          </p>
        </div>
      </div>
    );
  }

  return <ConversationArtifactWorkbenchPane conversationId={context.conversationId} artifactId={artifactId} />;
}
