export type MessageBlock =
  | { type: 'user';     text: string; ts: string }
  | { type: 'text';     text: string; ts: string }
  | { type: 'thinking'; text: string; ts: string }
  | { type: 'tool_use'; tool: string; input: Record<string, unknown>; output: string; durationMs?: number; ts: string }
  | { type: 'subagent'; name: string; prompt: string; status: 'running' | 'complete' | 'failed'; summary?: string; ts: string };

export interface MockConversation {
  id: string;
  title: string;
  messages: MessageBlock[];
}

// ─── web-ui-iteration ────────────────────────────────────────────────────────

const webUi: MockConversation = {
  id: 'web-ui-iteration',
  title: 'web UI iteration',
  messages: [
    {
      type: 'user',
      text: 'The build is failing after adding the new Sidebar. Can you debug it?',
      ts: '2026-03-10T13:00:00Z',
    },
    {
      type: 'thinking',
      text: 'The sidebar import the `relativeTime` helper from utils.ts, but looking at utils.ts the actual export is `timeAgo`. Classic rename mismatch. Let me confirm and fix it.',
      ts: '2026-03-10T13:00:01Z',
    },
    {
      type: 'tool_use',
      tool: 'bash',
      input: { command: 'cd packages/web && npm run build:client 2>&1 | head -20' },
      output: `x Build failed in 341ms
error during build:
src/components/Sidebar.tsx (5:9): "relativeTime" is not exported by "src/utils.ts"

3: import { useConversations, type Conversation } from '../hooks/useConversations';
4: import { ThemeSwitcher } from './ThemeSwitcher';
5: import { relativeTime } from '../utils';
            ^`,
      durationMs: 1240,
      ts: '2026-03-10T13:00:02Z',
    },
    {
      type: 'tool_use',
      tool: 'bash',
      input: { command: "grep -n 'export' packages/web/src/utils.ts | head -10" },
      output: `1:export function timeAgo(iso: string): string {
10:export function formatDate(iso: string): string {
31:export function kindMeta(kind: string) {
35:export function stripMarkdownListMarker(value: string | undefined): string {`,
      durationMs: 180,
      ts: '2026-03-10T13:00:03Z',
    },
    {
      type: 'tool_use',
      tool: 'bash',
      input: { command: "sed -i '' 's/relativeTime/timeAgo/g' packages/web/src/components/Sidebar.tsx packages/web/src/hooks/useConversations.ts" },
      output: '(no output)',
      durationMs: 90,
      ts: '2026-03-10T13:00:04Z',
    },
    {
      type: 'tool_use',
      tool: 'bash',
      input: { command: 'cd packages/web && npm run build:client 2>&1 | tail -3' },
      output: `dist/assets/index-BV8CuyVX.css   15.79 kB │ gzip:  3.73 kB
dist/assets/index-BV8CuyVX.js   186.37 kB │ gzip: 58.79 kB
✓ built in 542ms`,
      durationMs: 2100,
      ts: '2026-03-10T13:00:06Z',
    },
    {
      type: 'text',
      text: 'Fixed. `relativeTime` was renamed to `timeAgo` in utils.ts but the new Sidebar still used the old name. Patched both `Sidebar.tsx` and `useConversations.ts`. Build is clean.',
      ts: '2026-03-10T13:00:07Z',
    },
    {
      type: 'user',
      text: 'Now check what the UI looks like and iterate on the design — focus on the sidebar and inbox page.',
      ts: '2026-03-10T13:01:00Z',
    },
    {
      type: 'thinking',
      text: 'I need to take a screenshot of the current state using agent-browser, then make targeted improvements. Key things to look for: sidebar tab spacing, inbox typography, overall panel separation.',
      ts: '2026-03-10T13:01:01Z',
    },
    {
      type: 'tool_use',
      tool: 'bash',
      input: { command: 'agent-browser open http://localhost:3741 && sleep 1 && agent-browser screenshot /tmp/pa-ui.png && echo done' },
      output: '✓ personal agent\n  http://localhost:3741/\n✓ Screenshot saved to /tmp/pa-ui.png\ndone',
      durationMs: 3200,
      ts: '2026-03-10T13:01:02Z',
    },
    {
      type: 'tool_use',
      tool: 'read',
      input: { path: '/tmp/pa-ui.png' },
      output: '[Image: 1280×720 screenshot of personal agent web UI]',
      durationMs: 210,
      ts: '2026-03-10T13:01:05Z',
    },
    {
      type: 'text',
      text: `Looking at the screenshot, I can see a few issues to address:

1. **Sidebar tab spacing** is a bit tight — the dots and timestamps feel cramped
2. **Inbox items** need more vertical breathing room between the summary text and the tag/time row
3. **Context rail section headers** (WORKSTREAMS, ACTIVITY) are too bold relative to the content

Let me make targeted adjustments.`,
      ts: '2026-03-10T13:01:06Z',
    },
    {
      type: 'subagent',
      name: 'subagent-code-review',
      prompt: 'Review the web package for any obvious issues with the React component structure, missing key props, or accessibility problems.',
      status: 'complete',
      summary: 'Found 3 issues: (1) missing `key` prop on archived conversation list, (2) NavLink active class uses string concatenation that could be simplified, (3) ThemeSwitcher button lacks aria-label. All minor; no blocking issues.',
      ts: '2026-03-10T13:02:00Z',
    },
    {
      type: 'tool_use',
      tool: 'edit',
      input: {
        path: 'packages/web/src/components/Sidebar.tsx',
        oldText: 'archived.map(conv => (',
        newText: 'archived.map(conv => (',
      },
      output: 'File updated successfully.',
      durationMs: 45,
      ts: '2026-03-10T13:02:30Z',
    },
    {
      type: 'text',
      text: 'Applied all three fixes from the code review. The UI is looking good — the Arc-style tab sidebar is working with the close-to-archive UX, and the inbox feed shows real activity data.',
      ts: '2026-03-10T13:02:35Z',
    },
  ],
};

// ─── artifact-model-planning ─────────────────────────────────────────────────

const artifactModel: MockConversation = {
  id: 'artifact-model-planning',
  title: 'artifact model planning',
  messages: [
    {
      type: 'user',
      text: 'Design the workstream and artifact data model. Should be file-based, git-friendly, flat structure.',
      ts: '2026-03-10T10:00:00Z',
    },
    {
      type: 'thinking',
      text: `Key constraints:
- File-based so it works without a database
- Git-friendly means plain text/markdown with YAML frontmatter where possible  
- Flat structure (no nested dirs) so everything is predictable
- Must support: workstreams, artifacts per workstream, activity/inbox entries, cross-references

I'll model it as:
  profiles/<profile>/workstreams/<id>/
    summary.md   ← human-readable status
    plan.md      ← current step list
    artifacts/<artifact-id>.md  ← versioned docs
  profiles/<profile>/activity/<id>.json  ← structured inbox entries`,
      ts: '2026-03-10T10:00:01Z',
    },
    {
      type: 'tool_use',
      tool: 'bash',
      input: { command: 'find profiles/datadog -type f | head -30' },
      output: `profiles/datadog/agent/AGENTS.md
profiles/datadog/agent/memory/
profiles/datadog/agent/skills/
profiles/datadog/agent/tasks/`,
      durationMs: 95,
      ts: '2026-03-10T10:00:02Z',
    },
    {
      type: 'tool_use',
      tool: 'write',
      input: {
        path: 'packages/core/src/workstreams.ts',
        content: '// Workstream scaffold helpers...',
      },
      output: 'Wrote 4.2 KB to packages/core/src/workstreams.ts',
      durationMs: 55,
      ts: '2026-03-10T10:00:03Z',
    },
    {
      type: 'tool_use',
      tool: 'write',
      input: {
        path: 'packages/core/src/activity.ts',
        content: '// Activity entry read/write helpers...',
      },
      output: 'Wrote 2.8 KB to packages/core/src/activity.ts',
      durationMs: 40,
      ts: '2026-03-10T10:00:04Z',
    },
    {
      type: 'tool_use',
      tool: 'bash',
      input: { command: 'npm run build && npm test 2>&1 | tail -8' },
      output: `✓ packages/core/src/workstreams.test.ts (12 tests)
✓ packages/core/src/activity.test.ts (8 tests)
✓ packages/core/src/workstream-artifacts.test.ts (6 tests)

Test Files  3 passed (3)
Tests       26 passed (26)
Duration    1.42s`,
      durationMs: 4800,
      ts: '2026-03-10T10:00:05Z',
    },
    {
      type: 'text',
      text: `Data model is live. Here's what got built:

**Workstreams** live at \`profiles/<profile>/workstreams/<id>/\`:
- \`summary.md\` — human-readable status, blockers, progress
- \`plan.md\` — step list with completion state

**Activity** at \`profiles/<profile>/activity/<id>.json\`:
- Structured JSON: kind, summary, timestamp, linked workstream IDs
- Read by the CLI inbox surface and web API

**Artifacts** (next step) will live under each workstream dir.

All 26 tests passing. The model is intentionally minimal — just enough structure for the inbox and workstream views to work.`,
      ts: '2026-03-10T10:00:06Z',
    },
  ],
};

// ─── daemon-task-wiring ──────────────────────────────────────────────────────

const daemonWiring: MockConversation = {
  id: 'daemon-task-wiring',
  title: 'daemon task → activity',
  messages: [
    {
      type: 'user',
      text: 'Wire daemon task success/failure into the activity store so the inbox shows what ran.',
      ts: '2026-03-10T09:00:00Z',
    },
    {
      type: 'tool_use',
      tool: 'read',
      input: { path: 'packages/daemon/src/modules/tasks.ts' },
      output: '// tasks.ts — 180 lines\nexport class TaskRunner { ... }',
      durationMs: 120,
      ts: '2026-03-10T09:00:01Z',
    },
    {
      type: 'text',
      text: 'Found the right hook points — `onTaskComplete` and `onTaskFail` callbacks in `TaskRunner`. I\'ll call `writeProfileActivityEntry` from both.',
      ts: '2026-03-10T09:00:02Z',
    },
    {
      type: 'tool_use',
      tool: 'edit',
      input: {
        path: 'packages/daemon/src/modules/tasks.ts',
        oldText: '// TODO: emit activity on completion',
        newText: 'writeProfileActivityEntry({ repoRoot, profile, entry })',
      },
      output: 'File updated successfully.',
      durationMs: 38,
      ts: '2026-03-10T09:00:03Z',
    },
    {
      type: 'tool_use',
      tool: 'bash',
      input: { command: 'npm test -- packages/daemon 2>&1 | tail -6' },
      output: `✓ packages/daemon/src/modules/tasks.test.ts (18 tests)

Test Files  1 passed (1)
Tests       18 passed (18)
Duration    0.89s`,
      durationMs: 1900,
      ts: '2026-03-10T09:00:04Z',
    },
    {
      type: 'text',
      text: 'Wired. Every task run (success or failure) now writes a JSON entry to `profiles/<profile>/activity/`. The CLI `pa inbox` and web UI `/inbox` will reflect it immediately.',
      ts: '2026-03-10T09:00:05Z',
    },
  ],
};

export const MOCK_CONVERSATIONS: Record<string, MockConversation> = {
  [webUi.id]: webUi,
  [artifactModel.id]: artifactModel,
  [daemonWiring.id]: daemonWiring,
};
