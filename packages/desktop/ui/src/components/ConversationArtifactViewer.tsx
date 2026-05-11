import katex from 'katex';
import { useEffect, useMemo, useState } from 'react';

import { addNotification } from './notifications/notificationStore';
import { getLatexArtifactDisplayMode, looksLikeFullLatexDocument, normalizeLatexMathSource } from '../content/latexArtifacts';
import type { ConversationArtifactRecord } from '../shared/types';
import { ErrorState, LoadingState } from './ui';

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

        const msg = err instanceof Error ? err.message : 'Could not render this Mermaid diagram.';
        setError(msg);
        addNotification({ type: 'warning', message: msg, details: err instanceof Error ? err.stack : undefined, source: 'core' });
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

function LatexArtifactViewer({ artifact }: { artifact: ConversationArtifactRecord }) {
  const displayMode = useMemo(() => getLatexArtifactDisplayMode(artifact.content), [artifact.content]);
  const isFullDocument = useMemo(() => looksLikeFullLatexDocument(artifact.content), [artifact.content]);
  const mathPreviewHtml = useMemo(() => {
    if (displayMode !== 'math-preview-and-source') {
      return null;
    }

    return katex.renderToString(normalizeLatexMathSource(artifact.content), {
      displayMode: true,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
    });
  }, [artifact.content, displayMode]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto px-5 py-5">
      {mathPreviewHtml && (
        <div className="mb-4 rounded-xl border border-border-subtle bg-white px-6 py-5 text-black shadow-sm">
          <p className="ui-section-label text-[11px] uppercase tracking-[0.14em] text-slate-500">Math preview</p>
          <div className="mt-3" dangerouslySetInnerHTML={{ __html: mathPreviewHtml }} />
        </div>
      )}

      <div className="mb-3 min-w-0">
        <p className="ui-section-label">LaTeX source</p>
        <p className="mt-1 text-[12px] leading-relaxed text-secondary">
          {isFullDocument
            ? 'Full LaTeX documents are shown as raw source in the artifact viewer so the entire file remains visible and copyable.'
            : mathPreviewHtml
              ? 'This snippet includes a math preview above, with the raw LaTeX source shown below.'
              : 'Raw LaTeX source is shown directly in the artifact viewer.'}
        </p>
      </div>

      <pre className="min-h-0 overflow-auto rounded-xl border border-border-subtle bg-elevated px-4 py-4 font-mono text-[11px] leading-relaxed text-primary">
        {artifact.content}
      </pre>
    </div>
  );
}

export function ConversationArtifactViewer({ artifact }: { artifact: ConversationArtifactRecord }) {
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
