/**
 * AppPageViewer — renders a skill app page in an iframe
 * with the PA client injected for API access.
 */

import { useMemo } from 'react';

import type { SkillApp } from './types';

const PA_CLIENT_SRC = '<script src="/pa/client.js"><' + '/script>' + '<link rel="stylesheet" href="/pa/components.css" />';

/**
 * Build the full HTML document for an app page.
 * Injects the PA client script + component CSS inline so the iframe
 * can access the local API (requires allow-same-origin).
 */
function buildAppPageDocument(content: string, app: SkillApp): string {
  const trimmed = content.trim();
  const headInjection =
    '  <meta charset="utf-8" />\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    '  <base href="/apps/' +
    encodeURIComponent(app.name) +
    '/" />\n' +
    '  ' +
    PA_CLIENT_SRC +
    '\n';

  if (trimmed.toLowerCase().startsWith('<!doctype') || trimmed.toLowerCase().includes('<html')) {
    // Inject into existing html document
    return trimmed.replace('<head>', '<head>\n' + headInjection);
  }

  // Wrap bare content
  return (
    '<!doctype html>\n' +
    '<html class="pa-app">\n' +
    '<head>\n' +
    headInjection +
    '  <title>' +
    escapeHtml(app.name) +
    '</title>\n' +
    '</head>\n' +
    '<body class="pa-app" style="margin:0;padding:16px">\n' +
    content +
    '\n</body>\n</html>'
  );
}

export function AppPageViewer({ app, content, className }: { app: SkillApp; content: string; className?: string }) {
  const srcDoc = useMemo(() => buildAppPageDocument(content, app), [content, app]);

  return (
    <iframe
      title={app.name}
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      className={(className ?? '') + ' h-full w-full border-0'}
    />
  );
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
