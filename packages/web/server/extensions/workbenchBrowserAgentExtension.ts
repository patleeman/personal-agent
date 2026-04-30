import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

export interface WorkbenchBrowserToolHost {
  snapshot(conversationId: string): Promise<unknown>;
  screenshot(conversationId: string): Promise<unknown>;
  runScript(input: { conversationId: string; script: string; timeoutMs?: number }): Promise<unknown>;
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

const ScriptParams = Type.Object({
  script: Type.String({ description: 'JavaScript body to run. Use await browser.* operations and return a JSON-serializable value.' }),
  timeoutMs: Type.Optional(Type.Number({ description: 'Hard timeout in milliseconds. Defaults to 30000, max 60000.' })),
});

const SnapshotParams = Type.Object({
  includeScreenshot: Type.Optional(Type.Boolean({ description: 'Also include a screenshot image. Default false; use only when visual layout/image rendering matters or the user requested it.' })),
});
const ScreenshotParams = Type.Object({});

export function createWorkbenchBrowserAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'browser_snapshot',
      label: 'Browser Snapshot',
      description: 'Observe the current built-in Workbench Browser state and interactive elements.',
      promptSnippet: 'Use browser_snapshot as the browser equivalent of read: observe the current built-in Workbench Browser state before acting.',
      promptGuidelines: [
        'Targets the visible built-in Workbench Browser, not agent-browser or Chrome.',
        'Use this before browser_script when you need selectors or refs like @e1.',
        'Set includeScreenshot=true only when visual layout/image rendering matters or the user requested a screenshot; leave it false for normal text, feeds, forms, and page state.',
        'Refs are snapshot-scoped; refresh the snapshot after navigation or major page changes.',
      ],
      parameters: SnapshotParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const conversationId = ctx.sessionManager.getSessionId();
        const snapshot = await requireHost().snapshot(conversationId);
        const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
          { type: 'text' as const, text: formatSnapshot(snapshot) },
        ];
        let screenshotDetails: Record<string, unknown> | undefined;
        if (params.includeScreenshot === true) {
          const screenshot = await requireHost().screenshot(conversationId) as {
            dataBase64?: string;
            mimeType?: string;
            url?: string;
            title?: string;
            viewport?: unknown;
            capturedAt?: string;
          };
          content.push({ type: 'image' as const, data: screenshot.dataBase64 ?? '', mimeType: screenshot.mimeType ?? 'image/png' });
          screenshotDetails = {
            url: screenshot.url,
            title: screenshot.title,
            viewport: screenshot.viewport,
            capturedAt: screenshot.capturedAt,
          };
        }
        return {
          content,
          details: {
            snapshot: snapshot as Record<string, unknown>,
            ...(screenshotDetails ? { screenshot: screenshotDetails } : {}),
          },
        };
      },
    });

    pi.registerTool({
      name: 'browser_script',
      label: 'Browser Script',
      description: 'Run a JavaScript automation script against the built-in Workbench Browser.',
      promptSnippet: 'Use browser_script as the browser equivalent of bash: write a script with browser.goto/click/type/press/waitFor/evaluate, then run it in one call.',
      promptGuidelines: [
        'Do not chain tiny one-click tool calls; batch page work in one browser_script.',
        'Available API: goto, reload, back, forward, url, title, snapshot, screenshot, text, html, exists, query, click, type, press, scroll, select, check, uncheck, setInputFiles, wait, waitFor, waitForText, waitForLoadState, evaluate, log.',
        'Scripts run in an isolated worker. browser.evaluate runs in the loaded page context and is blocked on personal-agent://app pages.',
        'Return JSON-serializable data; use browser.log for concise diagnostics.',
      ],
      parameters: ScriptParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const conversationId = ctx.sessionManager.getSessionId();
        const result = await requireHost().runScript({
          conversationId,
          script: params.script,
          ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2).slice(0, 80_000) }],
          details: result as Record<string, unknown>,
        };
      },
    });

    pi.registerTool({
      name: 'browser_screenshot',
      label: 'Browser Screenshot',
      description: 'Capture a screenshot image of the built-in Workbench Browser. Prefer browser_snapshot for normal page understanding, optionally with includeScreenshot=true when visual capture is needed.',
      promptSnippet: 'Prefer browser_snapshot. Use browser_screenshot only when the user explicitly asks for a screenshot or image-only capture.',
      promptGuidelines: [
        'Default to browser_snapshot. It is cheaper, more structured, gives selectors/refs, and can include a screenshot with includeScreenshot=true.',
        'Do not use browser_screenshot to read normal text, lists, feeds, buttons, form state, or navigation state.',
        'Use browser_snapshot with includeScreenshot=true for visual layout checks so the agent also gets structured page state.',
        'Targets the visible built-in Workbench Browser session for this conversation.',
      ],
      parameters: ScreenshotParams,
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
