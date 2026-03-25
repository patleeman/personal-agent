import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { ConversationArtifactViewer } from '../components/ConversationArtifactViewer';
import { Pill, cx } from '../components/ui';
import { getConversationArtifactIdFromSearch, setConversationArtifactIdInSearch } from '../conversationArtifacts';
import { useAppEvents } from '../contexts';
import { useApi } from '../hooks';
import { formatDate, timeAgo } from '../utils';

function buildArtifactLocation(pathname: string, search: string, artifactId: string | null) {
  return {
    pathname,
    search: setConversationArtifactIdInSearch(search, artifactId),
  };
}

function ArtifactList({
  pathname,
  search,
  artifacts,
  selectedArtifactId,
}: {
  pathname: string;
  search: string;
  artifacts: Array<{
    id: string;
    title: string;
    kind: 'html' | 'mermaid' | 'latex';
    updatedAt: string;
    revision: number;
  }>;
  selectedArtifactId: string | null;
}) {
  return (
    <div className="border-t border-border-subtle/70">
      {artifacts.map((artifact) => {
        const selected = artifact.id === selectedArtifactId;

        return (
          <Link
            key={artifact.id}
            to={buildArtifactLocation(pathname, search, artifact.id)}
            className={cx(
              'block border-b border-border-subtle/70 px-4 py-3.5 transition-colors last:border-b-0',
              selected ? 'bg-elevated/80' : 'hover:bg-base/60',
            )}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="truncate text-[14px] font-medium text-primary">{artifact.title}</h3>
                  <Pill tone="accent" mono className="text-[10px]">{artifact.kind}</Pill>
                  {selected ? <Pill tone="muted" className="text-[10px]">open</Pill> : null}
                </div>
                <p className="mt-1 break-all text-[11px] font-mono text-secondary">{artifact.id}</p>
                <p className="mt-1 text-[11px] text-dim">rev {artifact.revision} · updated {timeAgo(artifact.updatedAt)}</p>
              </div>
              <span className="pt-0.5 text-[12px] text-accent">{selected ? 'opened' : 'open'}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function CompanionConversationArtifactOverlay({
  conversationId,
  artifactId,
  artifacts,
}: {
  conversationId: string;
  artifactId: string;
  artifacts: Array<{
    id: string;
    title: string;
    kind: 'html' | 'mermaid' | 'latex';
    updatedAt: string;
    revision: number;
  }>;
}) {
  const location = useLocation();
  const { versions } = useAppEvents();
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const fetchArtifact = useCallback(
    () => api.conversationArtifact(conversationId, artifactId),
    [artifactId, conversationId],
  );
  const {
    data,
    loading,
    refreshing,
    error,
    refetch,
  } = useApi(fetchArtifact, `companion-conversation-artifact:${conversationId}:${artifactId}`);

  useEffect(() => {
    setShowSource(false);
    setCopied(false);
  }, [artifactId]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (versions.sessions === 0) {
      return;
    }

    void refetch({ resetLoading: false });
  }, [refetch, versions.sessions]);

  const artifact = data?.artifact ?? null;
  const closeLocation = buildArtifactLocation(location.pathname, location.search, null);

  async function copySource() {
    if (!artifact) {
      return;
    }

    await navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="fixed inset-0 z-40 bg-base">
      <div className="flex h-full min-h-0 flex-col">
        <header className="border-b border-border-subtle bg-base/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.875rem)]">
            <div className="flex items-center justify-between gap-3">
              <Link to={closeLocation} className="text-[13px] font-medium text-accent transition-colors hover:text-accent/80">
                ← Conversation
              </Link>
              <button
                type="button"
                onClick={() => { void refetch({ resetLoading: false }); }}
                disabled={refreshing}
                className="rounded-lg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {artifact ? (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">Artifact</p>
                  <Pill tone="accent" mono>{artifact.kind}</Pill>
                  <Pill tone="muted">Read only</Pill>
                </div>
                <h2 className="mt-2 text-[24px] font-semibold tracking-tight text-primary">{artifact.title}</h2>
                <p className="mt-1 break-all text-[12px] font-mono text-secondary">{artifact.id}</p>
                <p className="mt-2 text-[12px] leading-relaxed text-dim">
                  Revision {artifact.revision} · updated {formatDate(artifact.updatedAt)} · View-only in the companion app.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
                  <button type="button" onClick={() => { void copySource(); }} className="ui-toolbar-button px-0 py-0 text-[11px]">
                    {copied ? 'copied' : artifact.kind === 'latex' ? 'copy latex' : 'copy source'}
                  </button>
                  {artifact.kind !== 'latex' && (
                    <button type="button" onClick={() => setShowSource((current) => !current)} className="ui-toolbar-button px-0 py-0 text-[11px]">
                      {showSource ? 'hide source' : 'show source'}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">Artifact</p>
                <h2 className="mt-2 text-[24px] font-semibold tracking-tight text-primary">Loading artifact…</h2>
                <p className="mt-2 break-all text-[12px] font-mono text-secondary">{artifactId}</p>
              </div>
            )}

            {artifacts.length > 1 ? (
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">More artifacts</p>
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {artifacts.map((item) => {
                    const selected = item.id === artifactId;
                    return (
                      <Link
                        key={item.id}
                        to={buildArtifactLocation(location.pathname, location.search, item.id)}
                        className={cx(
                          'shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors',
                          selected
                            ? 'border-accent/30 bg-accent/10 text-accent'
                            : 'border-border-subtle bg-surface text-secondary hover:bg-elevated hover:text-primary',
                        )}
                      >
                        {item.title}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col bg-base">
            {loading && !artifact ? (
              <p className="px-4 py-6 text-[13px] text-dim">Loading artifact…</p>
            ) : error || !artifact ? (
              <div className="px-4 py-6">
                <p className="text-[14px] font-medium text-danger">Unable to load this artifact.</p>
                <p className="mt-2 text-[13px] leading-relaxed text-secondary">{error || 'Artifact not found.'}</p>
              </div>
            ) : (
              <>
                <div className="min-h-[18rem] flex-1 overflow-hidden bg-base">
                  <ConversationArtifactViewer artifact={artifact} />
                </div>
                {showSource && artifact.kind !== 'latex' ? (
                  <div className="border-t border-border-subtle px-4 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">Source</p>
                    <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface px-4 py-4 font-mono text-[11px] leading-relaxed text-secondary">
                      {artifact.content}
                    </pre>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CompanionConversationArtifacts({ conversationId }: { conversationId: string }) {
  const location = useLocation();
  const { versions } = useAppEvents();
  const fetchArtifacts = useCallback(
    () => api.conversationArtifacts(conversationId),
    [conversationId],
  );
  const {
    data,
    loading,
    refreshing,
    error,
    refetch,
  } = useApi(fetchArtifacts, `companion-conversation-artifacts:${conversationId}`);

  useEffect(() => {
    if (versions.sessions === 0) {
      return;
    }

    void refetch({ resetLoading: false });
  }, [refetch, versions.sessions]);

  const artifacts = useMemo(() => data?.artifacts ?? [], [data?.artifacts]);
  const selectedArtifactId = getConversationArtifactIdFromSearch(location.search);
  const artifactCountLabel = `${artifacts.length} ${artifacts.length === 1 ? 'artifact' : 'artifacts'}`;

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface/70">
        <div className="flex items-start justify-between gap-3 px-4 py-3.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-medium text-primary">Artifacts</p>
              <Pill tone="muted">Read only</Pill>
            </div>
            <p className="mt-1 text-[11px] text-dim">
              {artifactCountLabel}
              <span className="mx-1.5 opacity-40">·</span>
              Saved outputs stay view-only on mobile.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { void refetch({ resetLoading: false }); }}
            disabled={refreshing}
            className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {loading && !data ? (
          <p className="border-t border-border-subtle/70 px-4 py-4 text-[13px] text-dim">Loading artifacts…</p>
        ) : null}

        {!loading && error ? (
          <p className="border-t border-border-subtle/70 px-4 py-4 text-[13px] text-danger">Unable to load artifacts: {error}</p>
        ) : null}

        {!loading && !error && artifacts.length === 0 ? (
          <div className="border-t border-border-subtle/70 px-4 py-4">
            <p className="text-[14px] font-medium text-primary">No artifacts yet.</p>
            <p className="mt-2 text-[13px] leading-relaxed text-secondary">
              Saved artifacts from this conversation will show up here. Open them read-only from your phone once they are ready.
            </p>
          </div>
        ) : null}

        {!loading && !error && artifacts.length > 0 ? (
          <ArtifactList
            pathname={location.pathname}
            search={location.search}
            artifacts={artifacts}
            selectedArtifactId={selectedArtifactId}
          />
        ) : null}
      </section>

      {selectedArtifactId ? (
        <CompanionConversationArtifactOverlay
          conversationId={conversationId}
          artifactId={selectedArtifactId}
          artifacts={artifacts}
        />
      ) : null}
    </>
  );
}
