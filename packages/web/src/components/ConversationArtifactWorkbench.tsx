import { useCallback, useEffect, useState } from 'react';
import { api } from '../client/api';
import { useAppEvents } from '../app/contexts';
import type { ConversationArtifactRecord, ConversationArtifactSummary } from '../shared/types';
import { formatDate } from '../shared/utils';
import { ConversationArtifactViewer } from './ConversationArtifactViewer';
import { ErrorState, LoadingState, cx } from './ui';

export function useConversationArtifactSummaries(conversationId: string | null | undefined) {
  const { versions } = useAppEvents();
  const [artifacts, setArtifacts] = useState<ConversationArtifactSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setArtifacts([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api.conversationArtifacts(conversationId)
      .then((result) => {
        if (!cancelled) {
          setArtifacts(result.artifacts);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setArtifacts([]);
          setError(err instanceof Error ? err.message : 'Failed to load artifacts.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, versions.artifacts]);

  return { artifacts, loading, error };
}

export function ConversationArtifactRailContent({
  artifacts,
  activeArtifactId,
  loading,
  error,
  onOpenArtifact,
}: {
  artifacts: ConversationArtifactSummary[];
  activeArtifactId: string | null;
  loading: boolean;
  error: string | null;
  onOpenArtifact: (artifactId: string) => void;
}) {
  if (loading && artifacts.length === 0) {
    return <LoadingState label="Loading artifacts…" className="justify-center h-full" />;
  }

  if (error && artifacts.length === 0) {
    return <ErrorState message={error} className="px-4 py-4" />;
  }

  if (artifacts.length === 0) {
    return <div className="px-4 py-5 text-[12px] text-dim">No artifacts in this conversation.</div>;
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto px-2 py-2">
      <div className="flex flex-col gap-1.5">
        {artifacts.map((artifact) => {
          const selected = artifact.id === activeArtifactId;
          return (
            <button
              key={artifact.id}
              type="button"
              onClick={() => onOpenArtifact(artifact.id)}
              className={cx(
                'rounded-xl px-3 py-2.5 text-left transition-colors',
                selected ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/60 hover:text-primary',
              )}
              title={`${artifact.title} · ${artifact.id} · rev ${artifact.revision}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{artifact.title}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-dim/70">{artifact.kind}</span>
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-dim">{artifact.id}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ConversationArtifactWorkbenchPane({
  conversationId,
  artifactId,
}: {
  conversationId: string;
  artifactId: string;
}) {
  const { versions } = useAppEvents();
  const [artifact, setArtifact] = useState<ConversationArtifactRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCopied(false);

    api.conversationArtifact(conversationId, artifactId)
      .then((result) => {
        if (!cancelled) {
          setArtifact(result.artifact);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setArtifact(null);
          setError(err instanceof Error ? err.message : 'Failed to load artifact.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [artifactId, conversationId, versions.artifacts]);

  const copySource = useCallback(async () => {
    if (!artifact) {
      return;
    }

    await navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [artifact]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-base">
      <div className="shrink-0 border-b border-border-subtle px-4 py-2.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0 flex flex-1 items-center gap-2.5">
            <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-dim/80">
              {artifact?.kind ?? 'artifact'}
            </span>
            <h2
              className="min-w-0 truncate text-[14px] font-medium text-primary"
              title={artifact ? `${artifact.title} · ${artifact.id} · rev ${artifact.revision} · updated ${formatDate(artifact.updatedAt)}` : artifactId}
            >
              {artifact?.title ?? artifactId}
            </h2>
            {artifact ? <span className="hidden shrink-0 text-[11px] text-dim sm:inline">rev {artifact.revision}</span> : null}
          </div>
          {artifact ? (
            <button type="button" onClick={() => { void copySource(); }} className="ui-toolbar-button shrink-0 px-2 py-1 text-[10px]">
              {copied ? 'copied' : artifact.kind === 'latex' ? 'copy latex' : 'copy source'}
            </button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {loading && !artifact ? (
          <LoadingState label="Loading artifact…" className="justify-center h-full" />
        ) : error || !artifact ? (
          <ErrorState message={error || 'Artifact not found.'} className="px-4 py-4" />
        ) : (
          <ConversationArtifactViewer artifact={artifact} />
        )}
      </div>
    </div>
  );
}
