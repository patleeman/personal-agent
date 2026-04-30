import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

export interface WorkbenchBrowserToolHost {
  snapshot(conversationId: string): Promise<unknown>;
  screenshot(conversationId: string): Promise<unknown>;
}

let host: WorkbenchBrowserToolHost | null = null;

export function setWorkbenchBrowserToolHost(nextHost: WorkbenchBrowserToolHost | null): void {
  host = nextHost;
}

function requireHost(): WorkbenchBrowserToolHost {
  if (!host) {
    throw new Error('Workbench Browser tools are only available in the desktop app.');
  }
  return host;
}

function formatSnapshot(value: unknown): string {
  const snapshot = value as {
    url?: string;
    title?: string;
    loading?: boolean;
    browserRevision?: number;
    lastSnapshotRevision?: number;
    changedSinceLastSnapshot?: boolean;
    lastChangeReason?: string;
    lastChangedAt?: string;
    text?: string;
    elements?: Array<{ ref?: string; role?: string; name?: string; selector?: string; text?: string; enabled?: boolean; checked?: boolean }>;
  };
  const lines = [
    `URL: ${snapshot.url ?? ''}`,
    `Title: ${snapshot.title ?? ''}`,
    `Loading: ${snapshot.loading === true ? 'yes' : 'no'}`,
    `Browser revision: ${snapshot.browserRevision ?? 0}`,
    `Changed since last snapshot: ${snapshot.changedSinceLastSnapshot === true ? 'yes' : 'no'}`,
  ];
  if (snapshot.lastChangeReason || snapshot.lastChangedAt) {
    lines.push(`Last browser change: ${snapshot.lastChangeReason ?? 'unknown'}${snapshot.lastChangedAt ? ` at ${snapshot.lastChangedAt}` : ''}`);
  }

  if (snapshot.elements?.length) {
    lines.push('', 'Elements:');
    for (const element of snapshot.elements.slice(0, 120)) {
      const state = [
        element.enabled === false ? 'disabled' : 'enabled',
        typeof element.checked === 'boolean' ? `checked=${element.checked}` : '',
      ].filter(Boolean).join(' ');
      lines.push(`${element.ref ?? ''} role=${element.role ?? ''} name=${JSON.stringify(element.name ?? '')} selector=${JSON.stringify(element.selector ?? '')} ${state}`.trim());
      if (element.text && element.text !== element.name) {
        lines.push(`  text=${JSON.stringify(element.text)}`);
      }
    }
  }

  if (snapshot.text) {
    lines.push('', 'Visible text:', snapshot.text.slice(0, 20_000));
  }

  return lines.join('\n');
}

const EmptyParams = Type.Object({});

export function createWorkbenchBrowserAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'browser_snapshot',
      label: 'Browser Snapshot',
      description: 'Observe the current built-in Workbench Browser state and interactive elements.',
      promptSnippet: 'Use browser_snapshot as the browser equivalent of read: observe URL/title/text/refs/selectors before navigating or acting. It is more efficient than screenshots for page state.',
      promptGuidelines: [
        'Targets the visible built-in Workbench Browser, not agent-browser or Chrome.',
        'Prefer browser_snapshot before navigating or acting because it is efficient, structured, and gives refs/selectors.',
        'Refs are snapshot-scoped; refresh the snapshot after navigation or major page changes.',
      ],
      parameters: EmptyParams,
      async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
        const conversationId = ctx.sessionManager.getSessionId();
        const snapshot = await requireHost().snapshot(conversationId);
        return {
          content: [{ type: 'text' as const, text: formatSnapshot(snapshot) }],
          details: snapshot as Record<string, unknown>,
        };
      },
    });

    pi.registerTool({
      name: 'browser_screenshot',
      label: 'Browser Screenshot',
      description: 'Capture a PNG screenshot of the built-in Workbench Browser.',
      promptSnippet: 'Use browser_screenshot when visual state matters. Prefer browser_snapshot for navigating, selectors, text, and page state because it is more efficient.',
      promptGuidelines: [
        'browser_screenshot is useful for visual appearance and image-heavy content.',
        'Prefer browser_snapshot when navigating or when you need efficient text, selectors, refs, or page state.',
        'Targets the visible built-in Workbench Browser session for this conversation.',
      ],
      parameters: EmptyParams,
      async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
        const conversationId = ctx.sessionManager.getSessionId();
        const screenshot = await requireHost().screenshot(conversationId) as {
          dataBase64?: string;
          mimeType?: string;
          url?: string;
          title?: string;
          viewport?: unknown;
          capturedAt?: string;
        };
        return {
          content: [
            { type: 'text' as const, text: 'Captured Workbench Browser screenshot.' },
            { type: 'image' as const, data: screenshot.dataBase64 ?? '', mimeType: screenshot.mimeType ?? 'image/png' },
          ],
          details: {
            url: screenshot.url,
            title: screenshot.title,
            viewport: screenshot.viewport,
            capturedAt: screenshot.capturedAt,
          },
        };
      },
    });
  };
}
