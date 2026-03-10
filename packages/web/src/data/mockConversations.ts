export type MessageBlock =
  | { type: 'user';      text: string; ts: string }
  | { type: 'text';      text: string; ts: string; streaming?: boolean }
  | { type: 'thinking';  text: string; ts: string }
  | { type: 'tool_use';  tool: string; input: Record<string, unknown>; output: string; durationMs?: number; ts: string; running?: boolean; error?: boolean }
  | { type: 'subagent';  name: string; prompt: string; status: 'running' | 'complete' | 'failed'; summary?: string; ts: string }
  | { type: 'image';     alt: string; width?: number; height?: number; caption?: string; ts: string }
  | { type: 'error';     tool?: string; message: string; ts: string };

export interface MockTask {
  id: string;
  title: string;
  schedule?: string;
  status: 'pending' | 'running' | 'done' | 'failed';
}

export interface MockArtifact {
  id: string;
  name: string;
  type: 'code' | 'document' | 'image' | 'data';
  language?: string;
  lines?: number;
  path?: string;
  updatedAt: string;
}

export interface MockFile {
  path: string;
  action: 'read' | 'write' | 'edit';
}

export interface MockReference {
  title: string;
  url: string;
  source?: string;
}

export interface MockPlanStep {
  text: string;
  done: boolean;
}

export interface MockConversation {
  id: string;
  title: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  workstreamId?: string;
  messages: MessageBlock[];
  // Right-rail context
  tasks?: MockTask[];
  artifacts?: MockArtifact[];
  files?: MockFile[];
  references?: MockReference[];
  plan?: MockPlanStep[];
}

// ─── web-ui-iteration ────────────────────────────────────────────────────────

const webUi: MockConversation = {
  id: 'web-ui-iteration',
  title: 'web UI iteration',
  model: 'claude-sonnet-4-6',
  inputTokens: 14280,
  outputTokens: 3140,
  workstreamId: 'web-ui',
  tasks: [
    { id: 't1', title: 'Daily build verification', schedule: '0 9 * * *', status: 'pending' },
    { id: 't2', title: 'Screenshot diff on push', status: 'done' },
  ],
  artifacts: [
    { id: 'a1', name: 'Sidebar.tsx',          type: 'code', language: 'TypeScript', lines: 189, path: 'packages/web/src/components/', updatedAt: '2026-03-10T13:02:35Z' },
    { id: 'a2', name: 'useConversations.ts',  type: 'code', language: 'TypeScript', lines: 78,  path: 'packages/web/src/hooks/',       updatedAt: '2026-03-10T13:02:00Z' },
    { id: 'a3', name: 'ChatView.tsx',         type: 'code', language: 'TypeScript', lines: 312, path: 'packages/web/src/components/chat/', updatedAt: '2026-03-10T13:02:35Z' },
  ],
  files: [
    { path: 'packages/web/src/utils.ts',                    action: 'read' },
    { path: 'packages/web/src/components/Sidebar.tsx',      action: 'edit' },
    { path: 'packages/web/src/hooks/useConversations.ts',   action: 'edit' },
  ],
  plan: [
    { text: 'Arc-style conversation sidebar',         done: true },
    { text: 'Chat interface with all block types',    done: true },
    { text: 'Slash menu + @ mentions',               done: false },
    { text: 'Context rail per-conversation',         done: false },
    { text: 'Connect to real Pi sessions',           done: false },
  ],
  messages: [
    { type: 'user', text: 'The build is failing after adding the new Sidebar. Can you debug it?', ts: '2026-03-10T13:00:00Z' },
    { type: 'thinking', text: 'The sidebar imports `relativeTime` from utils.ts, but the actual export is `timeAgo`. Classic rename mismatch. Let me confirm and fix it.', ts: '2026-03-10T13:00:01Z' },
    { type: 'tool_use', tool: 'bash', input: { command: 'cd packages/web && npm run build:client 2>&1 | head -20' }, output: `x Build failed in 341ms\nerror during build:\nsrc/components/Sidebar.tsx (5:9): "relativeTime" is not exported by "src/utils.ts"\n\n5: import { relativeTime } from '../utils';\n            ^`, durationMs: 1240, ts: '2026-03-10T13:00:02Z' },
    { type: 'tool_use', tool: 'bash', input: { command: "grep -n 'export' packages/web/src/utils.ts | head -5" }, output: `1:export function timeAgo(iso: string): string {\n10:export function formatDate(iso: string): string {`, durationMs: 180, ts: '2026-03-10T13:00:03Z' },
    { type: 'tool_use', tool: 'bash', input: { command: "sed -i '' 's/relativeTime/timeAgo/g' packages/web/src/components/Sidebar.tsx" }, output: '(no output)', durationMs: 90, ts: '2026-03-10T13:00:04Z' },
    { type: 'tool_use', tool: 'bash', input: { command: 'cd packages/web && npm run build:client 2>&1 | tail -3' }, output: `✓ built in 542ms`, durationMs: 2100, ts: '2026-03-10T13:00:06Z' },
    { type: 'text', text: 'Fixed. `relativeTime` was renamed to `timeAgo` in utils.ts but Sidebar still used the old name. Build is clean.', ts: '2026-03-10T13:00:07Z' },
    { type: 'user', text: 'Now check what the UI looks like and iterate on the design.', ts: '2026-03-10T13:01:00Z' },
    { type: 'tool_use', tool: 'bash', input: { command: 'agent-browser open http://localhost:3741 && sleep 1 && agent-browser screenshot /tmp/pa-ui.png' }, output: '✓ Screenshot saved to /tmp/pa-ui.png', durationMs: 3200, ts: '2026-03-10T13:01:02Z' },
    { type: 'tool_use', tool: 'read', input: { path: '/tmp/pa-ui.png' }, output: '[image]', durationMs: 210, ts: '2026-03-10T13:01:05Z' },
    { type: 'text', text: `Looking at the screenshot:\n\n1. **Sidebar tabs** are a bit tight — dots and timestamps feel cramped\n2. **Inbox items** need more breathing room between summary and tag row\n3. **Context rail** needs to be redesigned — currently shows global data, should be per-conversation context\n\nLet me fix the sidebar spacing and context rail now.`, ts: '2026-03-10T13:01:06Z' },
    { type: 'subagent', name: 'subagent-code-review', prompt: 'Review the web package for missing key props, accessibility issues, and any obvious bugs.', status: 'complete', summary: 'Found 3 issues: (1) missing `key` on archived conversation list, (2) ThemeSwitcher lacks aria-label, (3) NavLink active class could be simplified. All minor.', ts: '2026-03-10T13:02:00Z' },
    { type: 'text', text: 'Applied all fixes from code review. Arc-style tab sidebar is working with close-to-archive UX.', ts: '2026-03-10T13:02:35Z' },
  ],
};

// ─── artifact-model-planning ─────────────────────────────────────────────────

const artifactModel: MockConversation = {
  id: 'artifact-model-planning',
  title: 'artifact model planning',
  model: 'claude-sonnet-4-6',
  inputTokens: 8920,
  outputTokens: 2410,
  workstreamId: 'artifact-model',
  artifacts: [
    { id: 'a1', name: 'workstreams.ts',           type: 'code', language: 'TypeScript', lines: 142, path: 'packages/core/src/', updatedAt: '2026-03-10T10:00:03Z' },
    { id: 'a2', name: 'activity.ts',              type: 'code', language: 'TypeScript', lines: 98,  path: 'packages/core/src/', updatedAt: '2026-03-10T10:00:04Z' },
    { id: 'a3', name: 'workstream-artifacts.ts',  type: 'code', language: 'TypeScript', lines: 64,  path: 'packages/core/src/', updatedAt: '2026-03-10T10:00:05Z' },
    { id: 'a4', name: 'data-model.md',            type: 'document', path: 'docs/', updatedAt: '2026-03-10T10:00:06Z' },
  ],
  files: [
    { path: 'profiles/datadog',         action: 'read' },
    { path: 'packages/core/src/',       action: 'read' },
  ],
  plan: [
    { text: 'Define file schema and directory layout', done: true },
    { text: 'Implement workstream scaffold helpers',   done: true },
    { text: 'Implement activity read/write helpers',   done: true },
    { text: 'Wire to daemon task runner',              done: true },
    { text: 'Wire to CLI inbox surface',              done: false },
    { text: 'Expose via web API',                     done: false },
  ],
  messages: [
    { type: 'user', text: 'Design the workstream and artifact data model. File-based, git-friendly, flat structure. @web-ui should use the same schema.', ts: '2026-03-10T10:00:00Z' },
    { type: 'thinking', text: `Key constraints:\n- File-based, no database\n- Git-friendly: plain text/markdown with YAML frontmatter\n- Flat structure for predictability\n\nSchema:\n  profiles/<profile>/workstreams/<id>/summary.md\n  profiles/<profile>/workstreams/<id>/plan.md\n  profiles/<profile>/activity/<id>.json`, ts: '2026-03-10T10:00:01Z' },
    { type: 'tool_use', tool: 'bash', input: { command: 'find profiles/datadog -type f | head -20' }, output: `profiles/datadog/agent/AGENTS.md\nprofiles/datadog/agent/memory/\nprofiles/datadog/agent/skills/`, durationMs: 95, ts: '2026-03-10T10:00:02Z' },
    { type: 'tool_use', tool: 'write', input: { path: 'packages/core/src/workstreams.ts', content: '// ...' }, output: 'Wrote 4.2 KB', durationMs: 55, ts: '2026-03-10T10:00:03Z' },
    { type: 'tool_use', tool: 'write', input: { path: 'packages/core/src/activity.ts', content: '// ...' }, output: 'Wrote 2.8 KB', durationMs: 40, ts: '2026-03-10T10:00:04Z' },
    { type: 'tool_use', tool: 'bash', input: { command: 'npm run build && npm test 2>&1 | tail -6' }, output: `✓ 26 tests passed\nDuration 1.42s`, durationMs: 4800, ts: '2026-03-10T10:00:05Z' },
    { type: 'text', text: `Data model is live:\n\n**Workstreams** at \`profiles/<profile>/workstreams/<id>/\`:\n- \`summary.md\` — status, blockers, progress\n- \`plan.md\` — step list with completion state\n\n**Activity** at \`profiles/<profile>/activity/<id>.json\`:\n- Structured JSON: kind, summary, timestamp, linked workstream IDs\n\nAll 26 tests passing.`, ts: '2026-03-10T10:00:06Z' },
  ],
};

// ─── daemon-task-wiring ──────────────────────────────────────────────────────

const daemonWiring: MockConversation = {
  id: 'daemon-task-wiring',
  title: 'daemon task → activity',
  model: 'claude-sonnet-4-6',
  inputTokens: 4100,
  outputTokens: 890,
  workstreamId: 'artifact-model',
  files: [
    { path: 'packages/daemon/src/modules/tasks.ts', action: 'read' },
    { path: 'packages/daemon/src/modules/tasks.ts', action: 'edit' },
  ],
  plan: [
    { text: 'Read TaskRunner hook points',       done: true },
    { text: 'Call writeProfileActivityEntry',   done: true },
    { text: 'Wire failure path too',            done: true },
    { text: 'Update tests',                     done: true },
  ],
  messages: [
    { type: 'user', text: 'Wire daemon task success/failure into the activity store so the inbox shows what ran.', ts: '2026-03-10T09:00:00Z' },
    { type: 'tool_use', tool: 'read', input: { path: 'packages/daemon/src/modules/tasks.ts' }, output: '// tasks.ts — 180 lines\nexport class TaskRunner { ... }', durationMs: 120, ts: '2026-03-10T09:00:01Z' },
    { type: 'text', text: 'Found the right hook points — `onTaskComplete` and `onTaskFail` in `TaskRunner`. Calling `writeProfileActivityEntry` from both.', ts: '2026-03-10T09:00:02Z' },
    { type: 'tool_use', tool: 'edit', input: { path: 'packages/daemon/src/modules/tasks.ts', oldText: '// TODO: emit activity', newText: 'writeProfileActivityEntry(...)' }, output: 'File updated.', durationMs: 38, ts: '2026-03-10T09:00:03Z' },
    { type: 'tool_use', tool: 'bash', input: { command: 'npm test -- packages/daemon 2>&1 | tail -4' }, output: `✓ 18 tests passed\nDuration 0.89s`, durationMs: 1900, ts: '2026-03-10T09:00:04Z' },
    { type: 'text', text: 'Wired. Every task run now writes a JSON entry to `profiles/<profile>/activity/`. The CLI `pa inbox` and web UI `/inbox` reflect it immediately.', ts: '2026-03-10T09:00:05Z' },
  ],
};

// ─── live-research (RUNNING) ─────────────────────────────────────────────────

const liveResearch: MockConversation = {
  id: 'live-research',
  title: 'LLM tool use research',
  model: 'claude-opus-4',
  inputTokens: 22480,
  outputTokens: 1840,
  tasks: [
    { id: 't1', title: 'Weekly research digest', schedule: '0 8 * * 1', status: 'pending' },
  ],
  artifacts: [
    { id: 'a1', name: 'llm-tool-use-summary.md', type: 'document', path: 'research/', updatedAt: '2026-03-10T14:00:09Z' },
  ],
  references: [
    { title: 'Parallel Tool Execution in LLMs', url: 'https://arxiv.org/abs/2501.12345', source: 'ICML 2026' },
    { title: 'Self-Correcting Tool Use via Reflection', url: 'https://arxiv.org/abs/2502.67890', source: 'NeurIPS 2025' },
    { title: 'ToolBench: Benchmarking Tool-Augmented LLMs', url: 'https://arxiv.org/abs/2503.11111', source: 'arxiv 2025' },
  ],
  messages: [
    { type: 'user', text: 'Find recent papers on LLM tool use and summarize key patterns. Focus on 2025–2026. @artifact-model might be relevant context.', ts: '2026-03-10T14:00:00Z' },
    { type: 'thinking', text: `I should search arxiv and semantic scholar for recent work on tool-augmented LLMs. Key themes:\n- Tool selection strategies\n- Error recovery in multi-step tool use\n- Parallelism in tool calls\n- Verification patterns`, ts: '2026-03-10T14:00:01Z' },
    { type: 'tool_use', tool: 'web_search', input: { query: 'LLM tool use agent 2025 2026 arxiv survey' }, output: `1. "ToolBench: Benchmarking Tool-Augmented LLMs" — arxiv 2025\n2. "ReAct-v2: Improved Reasoning-Acting Loops" — arxiv 2026\n3. "Parallel Tool Execution in LLMs" — ICML 2026\n4. "Self-Correcting Tool Use via Reflection" — NeurIPS 2025`, durationMs: 1800, ts: '2026-03-10T14:00:02Z' },
    { type: 'tool_use', tool: 'web_fetch', input: { url: 'https://arxiv.org/abs/2501.12345' }, output: `Title: Parallel Tool Execution in LLMs\nAbstract: PAREX framework enables LLMs to identify and execute independent tool calls in parallel. 3.2× wall-clock speedup on ToolBench. 40–60% of multi-step sequences are parallelizable.`, durationMs: 2100, ts: '2026-03-10T14:00:04Z' },
    { type: 'tool_use', tool: 'web_fetch', input: { url: 'https://arxiv.org/abs/2502.67890' }, output: `Title: Self-Correcting Tool Use via Reflection\nAbstract: REFLECT adds post-execution verification. When violations detected, triggers targeted retries. 47% better error recovery on long-horizon tasks.`, durationMs: 1900, ts: '2026-03-10T14:00:06Z' },
    { type: 'tool_use', tool: 'bash', input: { command: "curl -s 'https://api.semanticscholar.org/graph/v1/paper/search?query=tool+use+LLM+2026&limit=5'" }, output: '', running: true, ts: '2026-03-10T14:00:08Z' },
    { type: 'text', text: 'Based on the papers so far, key patterns in LLM tool use research:\n\n**1. Parallel execution** (PAREX, ICML 2026)\n40–60% of tool sequences are parallelizable. 3× speedups available.\n\n**2. Self-correction via reflection** (REFLECT, NeurIPS 2025)\nPost-execution verification + targeted retry → 47% better error recovery.\n\n**3. Hierarchical planning**', ts: '2026-03-10T14:00:09Z', streaming: true },
  ],
};

// ─── screenshot-review ────────────────────────────────────────────────────────

const screenshotReview: MockConversation = {
  id: 'screenshot-review',
  title: 'UI screenshot review',
  model: 'claude-sonnet-4-6',
  inputTokens: 18650,
  outputTokens: 2290,
  workstreamId: 'web-ui',
  artifacts: [
    { id: 'a1', name: 'ui-light.png',  type: 'image', updatedAt: '2026-03-10T11:00:04Z' },
    { id: 'a2', name: 'ui-dark.png',   type: 'image', updatedAt: '2026-03-10T11:00:06Z' },
    { id: 'a3', name: 'ui-fixed.png',  type: 'image', updatedAt: '2026-03-10T11:01:05Z' },
    { id: 'a4', name: 'design-notes.md', type: 'document', updatedAt: '2026-03-10T11:01:06Z' },
  ],
  files: [
    { path: 'packages/web/src/index.css', action: 'edit' },
  ],
  messages: [
    { type: 'user', text: 'Take a screenshot of the web UI and flag any design issues. Check both light and dark mode.', ts: '2026-03-10T11:00:00Z' },
    { type: 'tool_use', tool: 'bash', input: { command: 'agent-browser open http://localhost:3741 && agent-browser screenshot /tmp/ui-light.png' }, output: '✓ Screenshot saved to /tmp/ui-light.png', durationMs: 2800, ts: '2026-03-10T11:00:01Z' },
    { type: 'tool_use', tool: 'read', input: { path: '/tmp/ui-light.png' }, output: '[image]', durationMs: 140, ts: '2026-03-10T11:00:04Z' },
    { type: 'image', alt: 'personal agent — light mode', width: 1280, height: 720, caption: '/tmp/ui-light.png', ts: '2026-03-10T11:00:04Z' },
    { type: 'tool_use', tool: 'bash', input: { command: 'agent-browser click @e1 && agent-browser screenshot /tmp/ui-dark.png' }, output: '✓ Screenshot saved to /tmp/ui-dark.png', durationMs: 1200, ts: '2026-03-10T11:00:05Z' },
    { type: 'tool_use', tool: 'read', input: { path: '/tmp/ui-dark.png' }, output: '[image]', durationMs: 140, ts: '2026-03-10T11:00:06Z' },
    { type: 'image', alt: 'personal agent — dark mode', width: 1280, height: 720, caption: '/tmp/ui-dark.png', ts: '2026-03-10T11:00:06Z' },
    { type: 'text', text: `Reviewed both screenshots. Issues flagged:\n\n**Light mode:**\n- Sidebar background nearly identical to main panel — low visual separation\n- Activity dots (6px) are small — consider 8px\n\n**Dark mode:**\n- Warm charcoal is working well\n- Amber accent pops nicely\n\n**Both modes:**\n- Context rail needs to be per-conversation, not global aggregate`, ts: '2026-03-10T11:00:07Z' },
    { type: 'user', text: 'Fix the sidebar separation and make the context rail per-conversation.', ts: '2026-03-10T11:01:00Z' },
    { type: 'tool_use', tool: 'edit', input: { path: 'packages/web/src/index.css', oldText: '--color-surface: 237 233 226;', newText: '--color-surface: 232 227 218;' }, output: 'File updated.', durationMs: 35, ts: '2026-03-10T11:01:02Z' },
    { type: 'tool_use', tool: 'bash', input: { command: 'agent-browser open http://localhost:3741 && agent-browser screenshot /tmp/ui-fixed.png' }, output: '✓ Screenshot saved to /tmp/ui-fixed.png', durationMs: 2600, ts: '2026-03-10T11:01:04Z' },
    { type: 'image', alt: 'personal agent — after sidebar fix', width: 1280, height: 720, caption: '/tmp/ui-fixed.png', ts: '2026-03-10T11:01:05Z' },
    { type: 'text', text: 'Sidebar background is now distinctly darker in light mode. Separation reads clearly without needing a border.', ts: '2026-03-10T11:01:06Z' },
  ],
};

// ─── rewind-fork-demo ────────────────────────────────────────────────────────

const rewindForkDemo: MockConversation = {
  id: 'rewind-fork-demo',
  title: 'pipeline debug + fork',
  model: 'claude-sonnet-4-6',
  inputTokens: 9340,
  outputTokens: 1980,
  files: [
    { path: 'packages/web/src/components/Sidebar.tsx',      action: 'edit' },
    { path: 'packages/web/src/pages/ConversationPage.tsx',  action: 'read' },
    { path: 'packages/web/src/pages/ConversationPage.tsx',  action: 'edit' },
  ],
  messages: [
    { type: 'user', text: 'The GitLab pipeline failed on the web package. Can you figure out why?', ts: '2026-03-10T08:00:00Z' },
    { type: 'thinking', text: 'Most likely: TypeScript errors, failed tests, or missing dependency. Let me pull the CI logs.', ts: '2026-03-10T08:00:01Z' },
    { type: 'tool_use', tool: 'bash', input: { command: 'pa gitlab logs --job build-web --branch wip/daemon-ui 2>&1 | tail -20' }, output: `[12:04:22] Running: npm run build:client\n[12:04:24] error TS2345: Argument of type 'string | undefined' is not assignable to 'string'\n[12:04:24]   at packages/web/src/pages/ConversationPage.tsx:8\n[12:04:24] error TS2304: Cannot find name 'relativeTime'\n[12:04:24]   at packages/web/src/components/Sidebar.tsx:5\n[12:04:24] Build failed with 2 errors`, durationMs: 3200, ts: '2026-03-10T08:00:02Z' },
    { type: 'text', text: 'Two TypeScript errors:\n\n1. `relativeTime` → renamed to `timeAgo`, one-liner fix\n2. `string | undefined` not assignable — need a null check at `ConversationPage.tsx:8`', ts: '2026-03-10T08:00:03Z' },
    { type: 'tool_use', tool: 'edit', input: { path: 'packages/web/src/components/Sidebar.tsx', oldText: "import { relativeTime }", newText: "import { timeAgo }" }, output: 'File updated.', durationMs: 30, ts: '2026-03-10T08:00:04Z' },
    { type: 'tool_use', tool: 'read', input: { path: 'packages/web/src/pages/ConversationPage.tsx' }, output: `const title = id.replace(/-/g, ' ');  // id could be undefined`, durationMs: 70, ts: '2026-03-10T08:00:05Z' },
    { type: 'tool_use', tool: 'edit', input: { path: 'packages/web/src/pages/ConversationPage.tsx', oldText: "id.replace", newText: "id?.replace" }, output: 'File updated.', durationMs: 28, ts: '2026-03-10T08:00:06Z' },
    { type: 'tool_use', tool: 'bash', input: { command: 'cd packages/web && npm run build:client 2>&1 | tail -2' }, output: '✓ built in 534ms', durationMs: 2100, ts: '2026-03-10T08:00:07Z' },
    { type: 'text', text: 'Both fixed. Pipeline should pass on next push. Want me to commit and push, or review the diff first?', ts: '2026-03-10T08:00:08Z' },
    { type: 'user', text: 'Actually — fork from before the ConversationPage edit and try a custom hook approach instead.', ts: '2026-03-10T08:02:00Z' },
    { type: 'text', text: `Forked from message 7 (before the ConversationPage edit). In the fork:\n\n- Null check moves into a \`useConversation(id)\` hook\n- Hook returns \`{ conv, title, notFound }\`\n- Original fix is preserved in this branch if you want to compare\n\nShall I implement the hook version?`, ts: '2026-03-10T08:02:01Z' },
    { type: 'error', tool: 'bash', message: 'Command timed out after 30s: git push origin wip/daemon-ui (network timeout — VPN disconnected?)', ts: '2026-03-10T08:03:00Z' },
    { type: 'user', text: "Fine, I'll push manually. Good work.", ts: '2026-03-10T08:04:00Z' },
    { type: 'text', text: "Got it. Two fixes in place locally. `git push origin wip/daemon-ui` when VPN is back.", ts: '2026-03-10T08:04:01Z' },
  ],
};

export const MOCK_CONVERSATIONS: Record<string, MockConversation> = {
  [webUi.id]:            webUi,
  [artifactModel.id]:    artifactModel,
  [daemonWiring.id]:     daemonWiring,
  [liveResearch.id]:     liveResearch,
  [screenshotReview.id]: screenshotReview,
  [rewindForkDemo.id]:   rewindForkDemo,
};
