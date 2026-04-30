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
    text?: string;
    elements?: Array<{ ref?: string; role?: string; name?: string; selector?: string; text?: string; enabled?: boolean; checked?: boolean }>;
  };
  const lines = [
    `URL: ${snapshot.url ?? ''}`,
    `Title: ${snapshot.title ?? ''}`,
    `Loading: ${snapshot.loading === true ? 'yes' : 'no'}`,
  ];

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

const EmptyParams = Type.Object({});

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
      description: 'Capture a PNG screenshot of the built-in Workbench Browser.',
      promptSnippet: 'Use browser_screenshot when visual layout matters and snapshot text is not enough.',
      promptGuidelines: [
        'Use browser_snapshot first for normal page understanding; use screenshots for visual layout/appearance checks.',
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
