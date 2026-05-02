import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

export interface WorkbenchBrowserToolHost {
  isActive(conversationId: string): Promise<boolean>;
  snapshot(conversationId: string): Promise<unknown>;
  screenshot(conversationId: string): Promise<unknown>;
  cdp(input: { conversationId: string; command: unknown; continueOnError?: boolean }): Promise<unknown>;
}

const BrowserToolNames = [
  'browser_snapshot',
  'browser_cdp',
  'browser_screenshot',
] as const;

const BrowserToolNameSet = new Set<string>(BrowserToolNames);

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

async function requireActiveWorkbenchBrowser(conversationId: string): Promise<WorkbenchBrowserToolHost> {
  const currentHost = requireHost();
  if (!await currentHost.isActive(conversationId)) {
    throw new Error('Workbench Browser is not active for this conversation. Open the Browser workbench panel before using browser tools.');
  }
  return currentHost;
}

async function isWorkbenchBrowserActive(conversationId: string): Promise<boolean> {
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

const CdpCommand = Type.Object({
  method: Type.String({ description: 'Chrome DevTools Protocol method in Domain.command form, for example Runtime.evaluate, Page.navigate, or DOM.getDocument.' }),
  params: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: 'CDP command params object.' })),
});

const CdpParams = Type.Object({
  command: Type.Union([
    CdpCommand,
    Type.Array(CdpCommand, { minItems: 1, maxItems: 200, description: 'Multiple CDP commands to execute sequentially.' }),
  ], { description: 'A single CDP command object { method, params? }, or an array of command objects.' }),
  continueOnError: Type.Optional(Type.Boolean({ description: 'Continue executing later commands after a protocol command fails. Defaults to false.' })),
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
      description: 'Observe the current built-in Workbench Browser state and interactive elements.',
      promptSnippet: 'Use browser_snapshot to understand the shared Workbench Browser, which is a user/agent communication surface. For development validation, use the agent-browser skill/CLI through bash instead.',
      promptGuidelines: [
        'Targets the user\'s visible built-in Workbench Browser for this conversation, not agent-browser, Chrome, or an independent automation session.',
        'Treat the Workbench Browser as shared conversation context: use it when the user is showing you a page, commenting on page elements, or wants you to inspect/control the same visible page.',
        'Do not use Workbench Browser tools for autonomous app-development validation, CI-style checks, or black-box UI testing; load the agent-browser skill and use its CLI/wrapper from bash for that.',
        'Prefer browser_snapshot before navigating or acting because it is efficient, structured, and gives refs/selectors.',
        'Refs are snapshot-scoped; refresh the snapshot after navigation or major page changes.',
      ],
      parameters: EmptyParams,
      async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
        const conversationId = ctx.sessionManager.getSessionId();
        const snapshot = await (await requireActiveWorkbenchBrowser(conversationId)).snapshot(conversationId);
        return {
          content: [{ type: 'text' as const, text: formatSnapshot(snapshot) }],
          details: snapshot as Record<string, unknown>,
        };
      },
    });

    pi.registerTool({
      name: 'browser_cdp',
      label: 'Browser CDP',
      description: 'Send one or more Chrome DevTools Protocol commands to the built-in Workbench Browser.',
      promptSnippet: 'Use browser_cdp only to act on the shared Workbench Browser conversation surface. For dev automation/testing, use the agent-browser skill/CLI through bash instead.',
      promptGuidelines: [
        'Targets the user\'s visible built-in Workbench Browser session for this conversation, not agent-browser, Chrome, or an independent automation session.',
        'Treat this as operating on shared user/agent context; avoid changing the user\'s visible page for unrelated development validation.',
        'For autonomous UI testing, local app validation, screenshots of the product under test, or repeatable browser automation, load the agent-browser skill and use its CLI/wrapper from bash.',
        'This is a thin CDP command surface; provide raw command objects exactly as Chrome DevTools Protocol expects, for example: {"method":"Runtime.evaluate","params":{"expression":"document.title","returnByValue":true}}.',
        'When doing more than one action, send one browser_cdp call with command set to an array of command objects instead of multiple tool calls.',
        'Prefer browser_snapshot for observation and browser_screenshot for visual checks; use browser_cdp when you need direct browser control.',
        'For page JS, use Runtime.evaluate with returnByValue=true when you need JSON-like results.',
      ],
      parameters: CdpParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const conversationId = ctx.sessionManager.getSessionId();
        const result = await (await requireActiveWorkbenchBrowser(conversationId)).cdp({
          conversationId,
          command: params.command,
          ...(params.continueOnError !== undefined ? { continueOnError: params.continueOnError } : {}),
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
      promptSnippet: 'Use browser_screenshot for the shared Workbench Browser when visual communication matters. For dev validation screenshots, use the agent-browser skill/CLI through bash.',
      promptGuidelines: [
        'Targets the user\'s visible built-in Workbench Browser session for this conversation, not agent-browser, Chrome, or an independent automation session.',
        'Treat screenshots as shared conversation context: use them when the user wants visual inspection of the page currently open in the Workbench Browser.',
        'For autonomous visual checks of the app you are developing, load the agent-browser skill and use its CLI/wrapper from bash.',
        'browser_screenshot is useful for visual appearance and image-heavy content.',
        'Prefer browser_snapshot when navigating or when you need efficient text, selectors, refs, or page state.',
      ],
      parameters: EmptyParams,
      async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
        const conversationId = ctx.sessionManager.getSessionId();
        const screenshot = await (await requireActiveWorkbenchBrowser(conversationId)).screenshot(conversationId) as {
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
