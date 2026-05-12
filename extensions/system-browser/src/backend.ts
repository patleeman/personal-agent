import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getWorkbenchBrowserToolHost, type WorkbenchBrowserToolHost } from '@personal-agent/extensions/backend/browser';
import { Type } from '@sinclair/typebox';

const BrowserToolNames = ['browser_snapshot', 'browser_cdp', 'browser_screenshot'] as const;

const BrowserToolNameSet = new Set<string>(BrowserToolNames);

function requireHost(): WorkbenchBrowserToolHost {
  const host = getWorkbenchBrowserToolHost();
  if (!host) {
    throw new Error('Workbench Browser tools are only available in the desktop app.');
  }
  return host;
}

async function requireActiveWorkbenchBrowser(conversationId: string): Promise<WorkbenchBrowserToolHost> {
  const currentHost = requireHost();
  if (!(await currentHost.isActive(conversationId))) {
    throw new Error('Workbench Browser is not active for this conversation. Open the Browser workbench panel before using browser tools.');
  }
  return currentHost;
}

async function isWorkbenchBrowserActive(conversationId: string): Promise<boolean> {
  const host = getWorkbenchBrowserToolHost();
  if (!host) {
    return false;
  }
  try {
    return await host.isActive(conversationId);
  } catch {
    return false;
  }
}

function setBrowserToolsActive(pi: ExtensionAPI, active: boolean): void {
  const current = pi.getActiveTools();
  const withoutBrowserTools = current.filter((name) => !BrowserToolNameSet.has(name));
  const next = active ? [...withoutBrowserTools, ...BrowserToolNames] : withoutBrowserTools;
  if (current.length === next.length && current.every((name, index) => name === next[index])) {
    return;
  }
  pi.setActiveTools(next);
}

async function syncBrowserToolsForSession(pi: ExtensionAPI, conversationId: string): Promise<void> {
  setBrowserToolsActive(pi, await isWorkbenchBrowserActive(conversationId));
}

function tabIdFromSessionKey(sessionKey: string): string {
  const prefix = '@global:tab-';
  return sessionKey.startsWith(prefix) ? sessionKey.slice(prefix.length) : sessionKey;
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
    pi.on('session_start', async (_event, ctx) => {
      await syncBrowserToolsForSession(pi, ctx.sessionManager.getSessionId());
    });

    pi.on('before_agent_start', async (_event, ctx) => {
      await syncBrowserToolsForSession(pi, ctx.sessionManager.getSessionId());
    });

    pi.registerTool({
      name: 'browser_snapshot',
      label: 'Browser Snapshot',
      description:
        'Observe the built-in Workbench Browser — active tab snapshot with structured elements, plus a list of all open tabs. Use tabId to target a specific tab.',
      promptSnippet:
        'Use browser_snapshot to understand the shared Workbench Browser. It returns the active tab snapshot plus a list of all open tabs with their tabId values. Pass tabId to target any tab. For development validation, use the agent-browser skill/CLI through bash instead.',
      promptGuidelines: [
        "Targets the user's visible built-in Workbench Browser for this conversation, not agent-browser, Chrome, or an independent automation session.",
        'The snapshot includes an "Open tabs" section listing all browser tabs with their tabId. Use these tabId values with any browser tool to target a specific tab.',
        'Treat the Workbench Browser as shared conversation context: use it when the user is showing you a page, commenting on page elements, or wants you to inspect/control the same visible page.',
        'Do not use Workbench Browser tools for autonomous app-development validation, CI-style checks, or black-box UI testing; load the agent-browser skill and use its CLI/wrapper from bash for that.',
        'Prefer browser_snapshot before navigating or acting because it is efficient, structured, and gives refs/selectors.',
        'Refs are snapshot-scoped; refresh the snapshot after navigation or major page changes.',
      ],
      parameters: SnapshotParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const conversationId = ctx.sessionManager.getSessionId();
        try {
          const host = await requireActiveWorkbenchBrowser(conversationId);
          const tabs = await host.listTabs();
          const tabId = (params as { tabId?: string }).tabId;
          const snapshot = await host.snapshot(conversationId, tabId);
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
        "Targets the user's visible built-in Workbench Browser session for this conversation, not agent-browser, Chrome, or an independent automation session.",
        'Use the tabId parameter to target a specific tab listed in browser_snapshot output. If omitted, targets the active tab.',
        "Treat this as operating on shared user/agent context; avoid changing the user's visible page for unrelated development validation.",
        'For autonomous UI testing, local app validation, screenshots of the product under test, or repeatable browser automation, load the agent-browser skill and use its CLI/wrapper from bash.',
        'This is a thin CDP command surface; provide raw command objects exactly as Chrome DevTools Protocol expects, for example: {"method":"Runtime.evaluate","params":{"expression":"document.title","returnByValue":true}}.',
        'When doing more than one action, send one browser_cdp call with command set to an array of command objects instead of multiple tool calls.',
        'Prefer browser_snapshot for observation and browser_screenshot for visual checks; use browser_cdp when you need direct browser control.',
        'For page JS, use Runtime.evaluate with returnByValue=true when you need JSON-like results.',
      ],
      parameters: CdpParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const conversationId = ctx.sessionManager.getSessionId();
        try {
          const result = await (
            await requireActiveWorkbenchBrowser(conversationId)
          ).cdp({
            conversationId,
            command: params.command,
            ...(params.continueOnError !== undefined ? { continueOnError: params.continueOnError } : {}),
            ...((params as { tabId?: string }).tabId ? { tabId: (params as { tabId: string }).tabId } : {}),
          });
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
        "Targets the user's visible built-in Workbench Browser session for this conversation, not agent-browser, Chrome, or an independent automation session.",
        'Use the tabId parameter to target a specific tab listed in browser_snapshot output. If omitted, targets the active tab.',
        'Treat screenshots as shared conversation context: use them when the user wants visual inspection of the page currently open in the Workbench Browser.',
        'For autonomous visual checks of the app you are developing, load the agent-browser skill and use its CLI/wrapper from bash.',
        'browser_screenshot is useful for visual appearance and image-heavy content.',
        'Prefer browser_snapshot when navigating or when you need efficient text, selectors, refs, or page state.',
      ],
      parameters: ScreenshotParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const conversationId = ctx.sessionManager.getSessionId();
        try {
          const host = await requireActiveWorkbenchBrowser(conversationId);
          const tabId = (params as { tabId?: string }).tabId;
          const screenshot = (await host.screenshot(conversationId, tabId)) as {
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
