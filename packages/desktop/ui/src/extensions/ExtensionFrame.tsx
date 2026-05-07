import { useEffect, useMemo, useState } from 'react';

import { buildApiPath } from '../client/apiBase';

export interface ExtensionFrameLaunchContext {
  extensionId: string;
  surfaceId: string;
  route?: string | null;
  pathname: string;
  search: string;
  hash: string;
  conversationId?: string | null;
  cwd?: string | null;
}

export function buildExtensionFileSrc(input: ExtensionFrameLaunchContext & { entry: string }): string {
  const query = new URLSearchParams({
    surfaceId: input.surfaceId,
    route: input.route ?? '',
    pathname: input.pathname,
    search: input.search,
    hash: input.hash,
  });
  if (input.conversationId) query.set('conversationId', input.conversationId);
  if (input.cwd) query.set('cwd', input.cwd);
  return buildApiPath(
    `/extensions/${encodeURIComponent(input.extensionId)}/files/${input.entry.split('/').map(encodeURIComponent).join('/')}?${query.toString()}`,
  );
}

function buildLaunchContextScript(context: ExtensionFrameLaunchContext): string {
  return `<script>window.__PA_LAUNCH_CONTEXT__=${JSON.stringify({
    extensionId: context.extensionId,
    surfaceId: context.surfaceId,
    route: context.route ?? '',
    pathname: context.pathname,
    search: context.search,
    hash: context.hash,
    conversationId: context.conversationId ?? null,
    cwd: context.cwd ?? null,
    theme: 'system',
  }).replace(/</g, '\\u003c')};</script>`;
}

function stripExternalPaAssets(html: string): string {
  return html
    .replace(/<script\s+src=["']\/pa\/client\.js["']\s*><\/script>/gi, '')
    .replace(/<link\s+rel=["']stylesheet["']\s+href=["']\/pa\/components\.css["']\s*\/?>/gi, '');
}

function inlineScript(source: string): string {
  return `<script>${source.replace(/<\/script/gi, '<\\/script')}</script>`;
}

function inlineStyle(source: string): string {
  return source ? `<style>${source.replace(/<\/style/gi, '<\\/style')}</style>` : '';
}

function injectLaunchContext(
  html: string,
  context: ExtensionFrameLaunchContext,
  baseHref: string,
  paClientSource: string,
  paComponentsCss: string,
): string {
  const script = buildLaunchContextScript(context);
  const base = `<base href="${baseHref.replace(/"/g, '&quot;')}">`;
  const assets = `${inlineStyle(paComponentsCss)}${script}${inlineScript(paClientSource)}`;
  const stripped = stripExternalPaAssets(html);
  if (/<head[^>]*>/i.test(stripped)) return stripped.replace(/<head([^>]*)>/i, `<head$1>${base}${assets}`);
  return `${base}${assets}${stripped}`;
}

export function ExtensionFrame({
  title,
  extensionId,
  entry,
  surfaceId,
  route,
  pathname,
  search,
  hash,
  conversationId,
  cwd,
  className = 'h-full w-full border-0 bg-base',
}: {
  title: string;
  extensionId: string;
  entry: string;
  surfaceId: string;
  route?: string | null;
  pathname: string;
  search: string;
  hash: string;
  conversationId?: string | null;
  cwd?: string | null;
  className?: string;
}) {
  const launchContext = useMemo(
    () => ({ extensionId, surfaceId, route, pathname, search, hash, conversationId, cwd }),
    [conversationId, cwd, extensionId, hash, pathname, route, search, surfaceId],
  );
  const src = useMemo(() => buildExtensionFileSrc({ ...launchContext, entry }), [entry, launchContext]);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);

  useEffect(() => {
    if (!entry.endsWith('.html')) {
      setSrcDoc(null);
      return;
    }

    let cancelled = false;
    setSrcDoc(null);
    Promise.all([
      fetch(src).then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load extension frame: ${response.status}`);
        return response.text();
      }),
      fetch(buildApiPath('/pa/client.js')).then(async (response) => (response.ok ? response.text() : '')),
      fetch(buildApiPath('/pa/components.css'))
        .then(async (response) => (response.ok ? response.text() : ''))
        .catch(() => ''),
    ])
      .then(([html, paClientSource, paComponentsCss]) => {
        const baseHref = src.slice(0, src.lastIndexOf('/') + 1);
        if (!cancelled) setSrcDoc(injectLaunchContext(html, launchContext, baseHref, paClientSource, paComponentsCss));
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setSrcDoc(`<main style="font:13px system-ui;padding:16px;color:#b42318;">${error.message}</main>`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [entry, launchContext, src]);

  return (
    <iframe
      title={title}
      src={srcDoc === null ? src : undefined}
      srcDoc={srcDoc ?? undefined}
      className={className}
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
    />
  );
}
