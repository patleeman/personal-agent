import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getWorkbenchBrowserToolHost, type WorkbenchBrowserToolHost } from '@personal-agent/extensions/backend/browser';
import { Type } from '@sinclair/typebox';

function requireHost(): WorkbenchBrowserToolHost {
  const host = getWorkbenchBrowserToolHost();
  if (!host) {
    throw new Error('Workbench Browser tools are only available in the desktop app.');
  }
  return host;
}

const BROWSER_TOOL_TIMEOUT_MS = 10_000;

class BrowserToolAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserToolAbortError';
  }
}

function tabIdFromSessionKey(sessionKey: string): string {
  const prefix = '@global:tab-';
  return sessionKey.startsWith(prefix) ? sessionKey.slice(prefix.length) : sessionKey;
}

function normalizeScreenshotImage(screenshot: { dataBase64?: string; mimeType?: string }): { data: string; mimeType: string } | undefined {
  const data = typeof screenshot.dataBase64 === 'string' ? screenshot.dataBase64.trim() : '';
  const mimeType = typeof screenshot.mimeType === 'string' ? screenshot.mimeType.trim() : 'image/png';
  if (!data || !mimeType.toLowerCase().startsWith('image/')) return undefined;
  return { data, mimeType };
}

async function withBrowserToolDeadline<T>(label: string, signal: AbortSignal | undefined, operation: Promise<T>): Promise<T> {
  if (signal?.aborted) {
    throw new BrowserToolAbortError(`${label} cancelled.`);
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new BrowserToolAbortError(`${label} timed out after ${BROWSER_TOOL_TIMEOUT_MS / 1000}s.`)),
      BROWSER_TOOL_TIMEOUT_MS,
    );
    abortHandler = () => reject(new BrowserToolAbortError(`${label} cancelled.`));
    signal?.addEventListener('abort', abortHandler, { once: true });
  });

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (abortHandler) {
      signal?.removeEventListener('abort', abortHandler);
    }
  }
}

function formatSnapshot(snapshot: unknown, tabs: Array<{ sessionKey: string; url: string; title: string }>, targetTabId?: string): string {
  const data = snapshot as {
    url?: string;
    title?: string;
    loading?: boolean;
    browserRevision?: number;
    lastSnapshotRevision?: number;
    changedSinceLastSnapshot?: boolean;
    lastChangeReason?: string;
    lastChangedAt?: string;
    text?: string;
    elements?: Array<{
      ref?: string;
      role?: string;
      name?: string;
      selector?: string;
      text?: string;
      enabled?: boolean;
      checked?: boolean;
    }>;
  };

  const snapshotUrl = data.url ?? '';

  const lines = [
    `URL: ${snapshotUrl}`,
    `Title: ${data.title ?? ''}`,
    `Loading: ${data.loading === true ? 'yes' : 'no'}`,
    `Browser revision: ${data.browserRevision ?? 0}`,
    `Changed since last snapshot: ${data.changedSinceLastSnapshot === true ? 'yes' : 'no'}`,
  ];
  if (data.lastChangeReason || data.lastChangedAt) {
    lines.push(`Last browser change: ${data.lastChangeReason ?? 'unknown'}${data.lastChangedAt ? ` at ${data.lastChangedAt}` : ''}`);
  }

  if (tabs.length > 0) {
    lines.push('', `Open tabs (${tabs.length}):`);
    for (const tab of tabs) {
      const tabId = tabIdFromSessionKey(tab.sessionKey);
      const isActive = tabId === targetTabId || (!targetTabId && tab.url === snapshotUrl);
      const isActiveMarker = isActive ? ' (active)' : '';
      lines.push(`  tabId=${tabId} title=${JSON.stringify(tab.title)} url=${tab.url}${isActiveMarker}`);
    }
  }

  if (data.elements?.length) {
    lines.push('', 'Elements:');
    for (const element of data.elements.slice(0, 120)) {
      const state = [
        element.enabled === false ? 'disabled' : 'enabled',
        typeof element.checked === 'boolean' ? `checked=${element.checked}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      lines.push(
        `${element.ref ?? ''} role=${element.role ?? ''} name=${JSON.stringify(element.name ?? '')} selector=${JSON.stringify(
          element.selector ?? '',
        )} ${state}`.trim(),
      );
      if (element.text && element.text !== element.name) {
        lines.push(`  text=${JSON.stringify(element.text)}`);
      }
    }
  }

  if (data.text) {
    lines.push('', 'Visible text:', data.text.slice(0, 20_000));
  }

  return lines.join('\n');
}

const TabIdParam = Type.Optional(
  Type.String({
    description:
      'Optional tab ID to target a specific tab. Get tab IDs from the "Open tabs" section of browser_snapshot output. Defaults to the active tab.',
  }),
);

const SnapshotParams = Type.Object({
  tabId: TabIdParam,
});

const CdpCommand = Type.Object({
  method: Type.String({
    description: 'Chrome DevTools Protocol method in Domain.command form, for example Runtime.evaluate, Page.navigate, or DOM.getDocument.',
  }),
  params: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: 'CDP command params object.' })),
});

const CdpParams = Type.Object({
  command: Type.Union(
    [CdpCommand, Type.Array(CdpCommand, { minItems: 1, maxItems: 200, description: 'Multiple CDP commands to execute sequentially.' })],
    { description: 'A single CDP command object { method, params? }, or an array of command objects.' },
  ),
  continueOnError: Type.Optional(
    Type.Boolean({ description: 'Continue executing later commands after a protocol command fails. Defaults to false.' }),
  ),
  tabId: TabIdParam,
});

const ScreenshotParams = Type.Object({
  tabId: TabIdParam,
});

export function createWorkbenchBrowserAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'browser_snapshot',
      label: 'Browser Snapshot',
      description:
        'Observe the built-in Workbench Browser — active tab snapshot with structured elements, plus a list of all open tabs. Use tabId to target a specific tab.',
      promptSnippet:
        'Use browser_snapshot to understand the shared Workbench Browser. It returns the active tab snapshot plus a list of all open tabs with their tabId values. Pass tabId to target any tab. For development validation, use the agent-browser skill/CLI through bash instead.',
      promptGuidelines: [
        "Use Workbench Browser tools only for the user's visible shared browser; start with browser_snapshot and use agent-browser CLI for autonomous dev/QA.",
      ],
      parameters: SnapshotParams,
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const conversationId = ctx.sessionManager.getSessionId();
        try {
          const host = requireHost();
          const tabs = await withBrowserToolDeadline('Browser tab listing', signal, host.listTabs());
          const tabId = (params as { tabId?: string }).tabId;
          const snapshot = await withBrowserToolDeadline('Browser snapshot', signal, host.snapshot(conversationId, tabId));
          return {
            content: [{ type: 'text' as const, text: formatSnapshot(snapshot, tabs, tabId) }],
            details: { snapshot, tabs } as Record<string, unknown>,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text' as const, text: `Browser snapshot failed: ${message}` }],
            isError: true,
            details: { action: 'snapshot', error: message },
          };
        }
      },
    });

    pi.registerTool({
      name: 'browser_cdp',
      label: 'Browser CDP',
      description: 'Send one or more Chrome DevTools Protocol commands to the Workbench Browser. Use tabId to target a specific tab.',
      promptSnippet:
        'Use browser_cdp to act on the shared Workbench Browser. Pass tabId to target a specific tab (get tab IDs from browser_snapshot). For dev automation/testing, use the agent-browser skill/CLI through bash instead.',
      promptGuidelines: [
        'browser_cdp controls the shared Workbench Browser; get tabId from browser_snapshot, batch multiple CDP commands in one call, and use agent-browser CLI for dev/QA automation.',
      ],
      parameters: CdpParams,
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const conversationId = ctx.sessionManager.getSessionId();
        try {
          const result = await withBrowserToolDeadline(
            'Browser CDP command',
            signal,
            requireHost().cdp({
              conversationId,
              command: params.command,
              ...(params.continueOnError !== undefined ? { continueOnError: params.continueOnError } : {}),
              ...((params as { tabId?: string }).tabId ? { tabId: (params as { tabId: string }).tabId } : {}),
            }),
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2).slice(0, 80_000) }],
            details: result as Record<string, unknown>,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Browser CDP command failed: ${message}. Try browser_snapshot first to check the browser state.`,
              },
            ],
            isError: true,
            details: { action: 'cdp', error: message },
          };
        }
      },
    });

    pi.registerTool({
      name: 'browser_screenshot',
      label: 'Browser Screenshot',
      description: 'Capture a PNG screenshot of the Workbench Browser. Use tabId to target a specific tab.',
      promptSnippet:
        'Use browser_screenshot for the shared Workbench Browser when visual communication matters. Pass tabId to target a specific tab (get tab IDs from browser_snapshot). For dev validation screenshots, use the agent-browser skill/CLI through bash.',
      promptGuidelines: [
        'browser_screenshot captures the shared Workbench Browser for user-facing visual context; use agent-browser CLI for product-under-test screenshots.',
      ],
      parameters: ScreenshotParams,
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const conversationId = ctx.sessionManager.getSessionId();
        try {
          const host = requireHost();
          const tabId = (params as { tabId?: string }).tabId;
          const screenshot = (await withBrowserToolDeadline('Browser screenshot', signal, host.screenshot(conversationId, tabId))) as {
            dataBase64?: string;
            mimeType?: string;
            url?: string;
            title?: string;
            viewport?: unknown;
            capturedAt?: string;
          };
          const image = normalizeScreenshotImage(screenshot);
          if (!image) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Browser screenshot failed: captured image data was empty or invalid. Try browser_snapshot first to check the browser state.',
                },
              ],
              isError: true,
              details: { action: 'screenshot', error: 'empty_image_data' },
            };
          }

          return {
            content: [
              { type: 'text' as const, text: 'Captured Workbench Browser screenshot.' },
              { type: 'image' as const, data: image.data, mimeType: image.mimeType },
            ],
            details: {
              url: screenshot.url,
              title: screenshot.title,
              viewport: screenshot.viewport,
              capturedAt: screenshot.capturedAt,
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Browser screenshot failed: ${message}. Try browser_snapshot first to check the browser state.`,
              },
            ],
            isError: true,
            details: { action: 'screenshot', error: message },
          };
        }
      },
    });
  };
}
