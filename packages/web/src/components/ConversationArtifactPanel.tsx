import { useCallback, useEffect, useMemo, useState } from 'react';
import katex from 'katex';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { getConversationArtifactIdFromSearch, setConversationArtifactIdInSearch } from '../conversationArtifacts';
import { useAppEvents } from '../contexts';
import { useApi } from '../hooks';
import type { ConversationArtifactRecord } from '../types';
import { formatDate } from '../utils';
import { ErrorState, LoadingState, Pill, cx } from './ui';

function buildArtifactDocument(content: string): string {
  const trimmed = content.trim();
  const looksLikeHtmlDocument = /^<!doctype\s+html|<html[\s>]/i.test(trimmed);
  if (looksLikeHtmlDocument) {
    return trimmed;
  }

  return [
    '<!doctype html>',
    '<html>',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '    <style>',
    '      :root { color-scheme: light dark; }',
    '      body { margin: 0; padding: 24px; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }',
    '    </style>',
    '  </head>',
    '  <body>',
    content,
    '  </body>',
    '</html>',
  ].join('\n');
}

function HtmlArtifactViewer({ artifact }: { artifact: ConversationArtifactRecord }) {
  const srcDoc = useMemo(() => buildArtifactDocument(artifact.content), [artifact.content]);

  return (
    <iframe
      title={artifact.title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      className="h-full w-full border-0 bg-white"
    />
  );
}

function MermaidArtifactViewer({ artifact }: { artifact: ConversationArtifactRecord }) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg('');
    setError(null);

    void import('mermaid')
      .then(async (module) => {
        const mermaid = module.default ?? module;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
        const renderId = `artifact-mermaid-${Math.random().toString(36).slice(2, 10)}`;
        const result = await mermaid.render(renderId, artifact.content);
        if (cancelled) {
          return;
        }

        setSvg(result.svg);
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }

        setError(err instanceof Error ? err.message : 'Could not render this Mermaid diagram.');
      });

    return () => {
      cancelled = true;
    };
  }, [artifact.content]);

  if (error) {
    return <ErrorState message={error} className="px-4 py-4" />;
  }

  if (!svg) {
    return <LoadingState label="Rendering diagram…" className="justify-center h-full" />;
  }

  return (
    <div className="flex h-full items-start justify-center overflow-auto px-5 py-5">
      <div className="w-full min-w-0" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

function normalizeLatexSource(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length >= 4) {
    return trimmed.slice(2, -2).trim();
  }
  if (trimmed.startsWith('\\[') && trimmed.endsWith('\\]') && trimmed.length >= 4) {
    return trimmed.slice(2, -2).trim();
  }
  if (trimmed.startsWith('$') && trimmed.endsWith('$') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function LatexArtifactViewer({ artifact }: { artifact: ConversationArtifactRecord }) {
  const html = useMemo(() => katex.renderToString(normalizeLatexSource(artifact.content), {
    displayMode: true,
    throwOnError: false,
    strict: 'ignore',
    trust: false,
  }), [artifact.content]);

  return (
    <div className="flex h-full items-start justify-center overflow-auto px-5 py-8">
      <div className="max-w-full rounded-xl bg-white px-6 py-5 text-black shadow-sm" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function ArtifactViewer({ artifact }: { artifact: ConversationArtifactRecord }) {
  switch (artifact.kind) {
    case 'html':
      return <HtmlArtifactViewer artifact={artifact} />;
    case 'mermaid':
      return <MermaidArtifactViewer artifact={artifact} />;
    case 'latex':
      return <LatexArtifactViewer artifact={artifact} />;
    default:
      return <ErrorState message={`Unsupported artifact kind: ${artifact.kind}`} className="px-4 py-4" />;
  }
}

export function ConversationArtifactPanel({
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
    void refetch({ resetLoading: false });
    void refetchList({ resetLoading: false });
  }, [refetch, refetchList, versions.sessions]);

  const artifact = artifactData?.artifact ?? null;
  const artifacts = artifactListData?.artifacts ?? [];

  function closeArtifact() {
    navigate({
      pathname: location.pathname,
      search: setConversationArtifactIdInSearch(location.search, null),
    });
  }

  function openArtifact(nextArtifactId: string) {
    navigate({
      pathname: location.pathname,
      search: setConversationArtifactIdInSearch(location.search, nextArtifactId),
    });
  }

  async function copySource() {
    if (!artifact) {
      return;
    }

    await navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  if (loading && !artifact) {
    return <LoadingState label="Loading artifact…" className="justify-center h-full" />;
  }

  if (error || !artifact) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div>
            <p className="ui-section-label">Artifact</p>
            <p className="text-[12px] text-secondary">{artifactId}</p>
          </div>
          <button type="button" onClick={closeArtifact} className="ui-toolbar-button">close</button>
        </div>
        <ErrorState message={error || 'Artifact not found.'} className="px-4 py-4" />
      </div>
    );
  }

  const selectedArtifactId = getConversationArtifactIdFromSearch(location.search);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border-subtle px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-[14px] font-semibold text-primary">{artifact.title}</h2>
              <Pill tone="accent" mono>{artifact.kind}</Pill>
            </div>
            <p className="mt-1 text-[12px] text-secondary font-mono">{artifact.id}</p>
            <p className="mt-1 text-[11px] text-dim">Revision {artifact.revision} · updated {formatDate(artifact.updatedAt)}</p>
          </div>
          <button type="button" onClick={closeArtifact} className="ui-toolbar-button shrink-0">close</button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
          <button type="button" onClick={() => { void copySource(); }} className="ui-toolbar-button px-0 py-0 text-[11px]">
            {copied ? 'copied' : 'copy source'}
          </button>
          <button type="button" onClick={() => setShowSource((current) => !current)} className="ui-toolbar-button px-0 py-0 text-[11px]">
            {showSource ? 'hide source' : 'show source'}
          </button>
        </div>
      </div>

      {artifacts.length > 1 && (
        <div className="border-b border-border-subtle px-4 py-3">
          <p className="ui-section-label">Artifacts</p>
          <div className="mt-2 flex flex-col gap-1.5">
            {artifacts.map((item) => {
              const selected = item.id === selectedArtifactId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openArtifact(item.id)}
                  className={cx(
                    'rounded-lg px-2.5 py-2 text-left transition-colors',
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
      )}

      <div className="min-h-0 flex-1 overflow-hidden bg-base">
        <ArtifactViewer artifact={artifact} />
      </div>

      {showSource && (
        <div className="max-h-[32%] overflow-auto border-t border-border-subtle px-4 py-3">
          <p className="ui-section-label">Source</p>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-secondary">
            {artifact.content}
          </pre>
        </div>
      )}
    </div>
  );
}
