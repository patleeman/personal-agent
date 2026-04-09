import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { getConversationArtifactIdFromSearch, setConversationArtifactIdInSearch } from '../conversationArtifacts';
import { useAppEvents } from '../contexts';
import { useApi } from '../hooks';
import { formatDate } from '../utils';
import { ConversationArtifactViewer } from './ConversationArtifactViewer';
import { ErrorState, LoadingState, Pill, cx } from './ui';

export function ConversationArtifactModal({
  conversationId,
  artifactId,
}: {
  conversationId: string;
  artifactId: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { versions } = useAppEvents();
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);

  const artifactFetcher = useCallback(() => api.conversationArtifact(conversationId, artifactId), [artifactId, conversationId]);
  const listFetcher = useCallback(() => api.conversationArtifacts(conversationId), [conversationId]);
  const {
    data: artifactData,
    loading,
    error,
    refetch,
  } = useApi(artifactFetcher, `${conversationId}:${artifactId}`);
  const {
    data: artifactListData,
    refetch: refetchList,
  } = useApi(listFetcher, `${conversationId}:artifacts`);

  useEffect(() => {
    setShowSource(false);
    setCopied(false);
  }, [artifactId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const closeArtifact = useCallback(() => {
    navigate({
      pathname: location.pathname,
      search: setConversationArtifactIdInSearch(location.search, null),
    });
  }, [location.pathname, location.search, navigate]);

  const openArtifact = useCallback((nextArtifactId: string) => {
    navigate({
      pathname: location.pathname,
      search: setConversationArtifactIdInSearch(location.search, nextArtifactId),
    });
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeArtifact();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeArtifact]);

  useEffect(() => {
    void refetch({ resetLoading: false });
    void refetchList({ resetLoading: false });
  }, [refetch, refetchList, versions.artifacts]);

  const artifact = artifactData?.artifact ?? null;
  const artifacts = artifactListData?.artifacts ?? [];

  async function copySource() {
    if (!artifact) {
      return;
    }

    await navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  const selectedArtifactId = getConversationArtifactIdFromSearch(location.search);

  return (
    <div
      className="ui-overlay-backdrop"
      style={{ background: 'rgb(0 0 0 / 0.55)', backdropFilter: 'blur(2px)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeArtifact();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Conversation artifact"
        className="ui-dialog-shell"
        style={{ width: 'min(1200px, calc(100vw - 3rem))', height: 'min(85vh, 920px)', maxHeight: 'calc(100vh - 3rem)' }}
      >
        <div className="border-b border-border-subtle px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <p className="ui-section-label">Artifact</p>
                {artifact ? <Pill tone="accent" mono>{artifact.kind}</Pill> : null}
              </div>
              <h2 className="mt-1 truncate text-[16px] font-semibold text-primary">{artifact?.title ?? artifactId}</h2>
              <p className="mt-1 break-all font-mono text-[12px] text-secondary">{artifact?.id ?? artifactId}</p>
              {artifact ? (
                <p className="mt-1 text-[11px] text-dim">Revision {artifact.revision} · updated {formatDate(artifact.updatedAt)}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {artifact ? (
                <>
                  <button type="button" onClick={() => { void copySource(); }} className="ui-toolbar-button text-[11px]">
                    {copied ? 'copied' : artifact.kind === 'latex' ? 'copy latex' : 'copy source'}
                  </button>
                  {artifact.kind !== 'latex' ? (
                    <button type="button" onClick={() => setShowSource((current) => !current)} className="ui-toolbar-button text-[11px]">
                      {showSource ? 'hide source' : 'show source'}
                    </button>
                  ) : null}
                </>
              ) : null}
              <button type="button" onClick={closeArtifact} className="ui-toolbar-button">close</button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex flex-1 overflow-hidden">
          {artifacts.length > 1 ? (
            <div className="hidden w-72 shrink-0 border-r border-border-subtle bg-base/40 lg:flex lg:flex-col">
              <div className="border-b border-border-subtle px-4 py-3">
                <p className="ui-section-label">Artifacts</p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                <div className="flex flex-col gap-1.5">
                  {artifacts.map((item) => {
                    const selected = item.id === selectedArtifactId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openArtifact(item.id)}
                        className={cx(
                          'rounded-xl px-3 py-2.5 text-left transition-colors',
                          selected ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/60 hover:text-primary',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[12px] font-medium">{item.title}</span>
                          <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-dim/70">{item.kind}</span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-dim font-mono">{item.id}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          <div className="min-h-0 flex flex-1 flex-col overflow-hidden bg-base">
            {artifacts.length > 1 ? (
              <div className="border-b border-border-subtle px-4 py-2.5 lg:hidden">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {artifacts.map((item) => {
                    const selected = item.id === selectedArtifactId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openArtifact(item.id)}
                        className={cx(
                          'shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors',
                          selected
                            ? 'border-accent/30 bg-accent/10 text-accent'
                            : 'border-border-subtle bg-surface text-secondary hover:bg-elevated hover:text-primary',
                        )}
                      >
                        {item.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-hidden">
              {loading && !artifact ? (
                <LoadingState label="Loading artifact…" className="justify-center h-full" />
              ) : error || !artifact ? (
                <ErrorState message={error || 'Artifact not found.'} className="px-4 py-4" />
              ) : (
                <ConversationArtifactViewer artifact={artifact} />
              )}
            </div>

            {showSource && artifact && artifact.kind !== 'latex' ? (
              <div className="max-h-[38%] overflow-auto border-t border-border-subtle px-4 py-3">
                <p className="ui-section-label">Source</p>
                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-secondary">
                  {artifact.content}
                </pre>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
