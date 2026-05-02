/* eslint-env node */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createEmptyDeferredResumeState,
  getDurableSessionsDir,
  getDurableTasksDir,
  markConversationAttentionUnread,
  createProjectActivityEntry,
  saveConversationArtifact,
  saveConversationAttachment,
  saveConversationCommitCheckpoint,
  saveDeferredResumeState,
  setActivityConversationLinks,
  writeProfileActivityEntry,
  writeMachineConfig,
} from '@personal-agent/core';
import {
  createStoredAutomation,
  createDurableRunManifest,
  createInitialDurableRunStatus,
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
  saveDurableRunCheckpoint,
  saveDurableRunManifest,
  saveDurableRunStatus,
} from '@personal-agent/daemon';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '..');
const demoProfile = 'shared';
const now = '2026-04-30T12:00:00.000Z';
const stateRoot = mkdtempSync(join(tmpdir(), 'personal-agent-desktop-demo-'));
const vaultRoot = join(stateRoot, 'vault');
const configRoot = join(stateRoot, 'config');
const sessionsRoot = getDurableSessionsDir(stateRoot);
const tasksRoot = getDurableTasksDir(configRoot);
const daemonRoot = join(stateRoot, 'daemon');
const runsRoot = resolveDurableRunsRoot(daemonRoot);
const runtimeSettingsFile = join(stateRoot, 'pi-agent-runtime', 'settings.json');
const localSettingsFile = join(configRoot, 'local', 'settings.json');
const desktopUserDataDir = join(stateRoot, 'desktop', 'user-data');
const initialRoute = '/conversations/demo-rich';

process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
process.env.PERSONAL_AGENT_CONFIG_ROOT = configRoot;
process.env.PERSONAL_AGENT_VAULT_ROOT = vaultRoot;
process.env.PERSONAL_AGENT_PROFILE = demoProfile;
process.env.PERSONAL_AGENT_ACTIVE_PROFILE = demoProfile;

function mkdirp(path) {
  mkdirSync(path, { recursive: true });
}

function write(path, content) {
  mkdirp(dirname(path));
  writeFileSync(path, content, 'utf-8');
}

function jsonLine(value) {
  return `${JSON.stringify(value)}\n`;
}

function writeSession({ id, fileName, cwd, title, timestamp = now, lines = [] }) {
  const cwdSlug = cwd.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  const dir = join(sessionsRoot, `--${cwdSlug}--`);
  mkdirp(dir);
  const file = join(dir, fileName ?? `${timestamp.replace(/[:.]/g, '-')}_${id}.jsonl`);
  const body = [
    { type: 'session', id, timestamp, cwd },
    { type: 'model_change', modelId: 'gpt-5.4' },
    { type: 'message', id: `${id}-user-1`, parentId: null, timestamp, message: { role: 'user', content: title } },
    ...lines,
  ].map(jsonLine).join('');
  write(file, body);
  return file;
}

function assistantText(id, idx, text, parentId, ts = `2026-04-30T12:00:0${idx}.000Z`) {
  return {
    type: 'message',
    id: `${id}-assistant-${idx}`,
    parentId,
    timestamp: ts,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  };
}

function assistantMixed(id, idx, parentId, content, ts = `2026-04-30T12:00:1${idx}.000Z`) {
  return {
    type: 'message',
    id: `${id}-assistant-mixed-${idx}`,
    parentId,
    timestamp: ts,
    message: { role: 'assistant', content },
  };
}

function toolResult(id, idx, parentId, toolCallId, toolName, output, details = {}, ts = `2026-04-30T12:00:2${idx}.000Z`) {
  return {
    type: 'message',
    id: `${id}-tool-result-${idx}`,
    parentId,
    timestamp: ts,
    message: {
      role: 'toolResult',
      toolCallId,
      toolName,
      details,
      content: [{ type: 'text', text: output }],
    },
  };
}

function customMessage(id, suffix, parentId, customType, content, details = {}, display = false, timestamp = now) {
  return {
    type: 'custom_message',
    id: `${id}-${suffix}`,
    parentId,
    timestamp,
    customType,
    content,
    details,
    display,
  };
}

mkdirp(vaultRoot);
mkdirp(configRoot);
mkdirp(tasksRoot);
mkdirp(runsRoot);
writeMachineConfig({ vaultRoot }, { configRoot });

write(join(vaultRoot, 'AGENTS.md'), '# Demo vault\n\nThis is seeded demo data for the desktop app.\n');
write(join(vaultRoot, 'notes', 'demo-plan.md'), '# Demo plan\n\n- Validate conversations\n- Validate automations\n- Validate runs\n- Validate reminders and queue states\n');
write(join(vaultRoot, 'projects', 'desktop-demo.md'), '# Desktop demo\n\nCurated seeded workspace for QA and demos.\n');
write(join(vaultRoot, 'notes', 'corrupt-note.md'), '{ this is intentionally malformed-ish content for UI resilience checks }\n');

const convEmpty = writeSession({
  id: 'demo-empty',
  cwd: repoRoot,
  title: 'Create a release checklist note',
  lines: [],
});

writeSession({
  id: 'demo-normal',
  cwd: repoRoot,
  title: 'What shipped in the last desktop release?',
  lines: [
    assistantText('demo-normal', 1, 'The last release tightened the Runs UI, browser tooling, and a pile of quality-of-life fixes.', 'demo-normal-user-1'),
    {
      type: 'session_info',
      id: 'demo-normal-info',
      parentId: 'demo-normal-assistant-1',
      timestamp: now,
      name: 'Release recap',
    },
  ],
});

writeSession({
  id: 'demo-tools',
  cwd: repoRoot,
  title: 'Audit the automations page for weirdness',
  lines: [
    assistantMixed('demo-tools', 1, 'demo-tools-user-1', [
      { type: 'toolCall', id: 'call-demo-tools-1', name: 'bash', arguments: { command: 'rg -n "automation" packages/web/src' } },
    ]),
    toolResult('demo-tools', 1, 'demo-tools-assistant-mixed-1', 'call-demo-tools-1', 'bash', 'packages/web/src/pages/TasksPage.tsx:12:export function TasksPage() {}', { action: 'read' }),
    assistantText('demo-tools', 2, 'Found the Tasks page entrypoint and a few automation-related components worth checking.', 'demo-tools-tool-result-1'),
  ],
});

writeSession({
  id: 'demo-running',
  cwd: repoRoot,
  title: 'Continue validating the workbench browser integration',
  lines: [
    assistantText('demo-running', 1, 'I am still checking the browser flows and live session hooks.', 'demo-running-user-1'),
    customMessage('demo-running', 'auto-running', 'demo-running-assistant-1', 'conversation_auto_mode', 'Auto mode enabled', { enabled: true }, false),
  ],
});

writeSession({
  id: 'demo-rich',
  cwd: repoRoot,
  title: 'Build a demo environment for desktop QA',
  lines: [
    assistantText('demo-rich', 1, 'I seeded a deterministic desktop dataset with conversations, automations, runs, and assets.', 'demo-rich-user-1'),
  ],
});

const convReminder = writeSession({
  id: 'demo-reminder',
  cwd: repoRoot,
  title: 'Remind me to verify the onboarding flow later',
  lines: [
    assistantText('demo-reminder', 1, 'I scheduled a reminder and kept the thread ready for later follow-up.', 'demo-reminder-user-1'),
  ],
});

const convAutoReview = writeSession({
  id: 'demo-auto-review',
  cwd: repoRoot,
  title: 'Keep going until the QA pass is done',
  lines: [
    assistantText('demo-auto-review', 1, 'First visible assistant reply.', 'demo-auto-review-user-1', '2026-04-30T12:00:01.000Z'),
    customMessage('demo-auto-review', 'hidden-review', 'demo-auto-review-assistant-1', 'conversation_automation_post_turn_review', [{ type: 'text', text: 'Hidden bookkeeping prompt.' }], {}, false, '2026-04-30T12:00:02.000Z'),
    assistantMixed('demo-auto-review', 2, 'demo-auto-review-hidden-review', [
      { type: 'thinking', thinking: 'Reviewing whether auto mode should keep going.' },
      { type: 'toolCall', id: 'call-demo-auto-review-1', name: 'conversation_auto_control', arguments: { action: 'stop', reason: 'done' } },
    ], '2026-04-30T12:00:03.000Z'),
    toolResult('demo-auto-review', 2, 'demo-auto-review-assistant-mixed-2', 'call-demo-auto-review-1', 'conversation_auto_control', 'Stopped auto mode: done.', {}, '2026-04-30T12:00:04.000Z'),
    assistantText('demo-auto-review', 3, 'The autonomous pass is complete.', 'demo-auto-review-tool-result-2', '2026-04-30T12:00:05.000Z'),
  ],
});

const parentSessionFile = writeSession({
  id: 'demo-parent',
  cwd: repoRoot,
  title: 'Parent conversation for subagent work',
  lines: [assistantText('demo-parent', 1, 'Spawning a helper thread for the docs audit.', 'demo-parent-user-1')],
});

writeSession({
  id: 'demo-subagent-child',
  cwd: repoRoot,
  fileName: '2026-04-30T12-40-00-000Z_demo-subagent-child.jsonl',
  title: 'Child conversation for docs audit',
  lines: [assistantText('demo-subagent-child', 1, 'I checked the docs references and found two stale examples.', 'demo-subagent-child-user-1')],
}).replace(/.*/, (file) => file);
const subagentDir = join(sessionsRoot, '__runs', 'run-subagent-demo');
mkdirp(subagentDir);
write(join(subagentDir, '2026-04-30T12-40-00-000Z_demo-subagent-child.jsonl'), [
  jsonLine({ type: 'session', id: 'demo-subagent-child', timestamp: '2026-04-30T12:40:00.000Z', cwd: repoRoot, parentSession: parentSessionFile }),
  jsonLine({ type: 'model_change', modelId: 'gpt-5.4' }),
  jsonLine({ type: 'message', id: 'demo-subagent-child-user-1', parentId: null, timestamp: '2026-04-30T12:40:00.000Z', message: { role: 'user', content: 'Audit the docs links.' } }),
  jsonLine({ type: 'message', id: 'demo-subagent-child-assistant-1', parentId: 'demo-subagent-child-user-1', timestamp: '2026-04-30T12:40:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'I checked the docs references and found two stale examples.' }] } }),
].join(''));

const convParallel = writeSession({
  id: 'demo-parallel-parent',
  cwd: repoRoot,
  title: 'Run two parallel follow-up prompts',
  lines: [assistantText('demo-parallel-parent', 1, 'Two parallel checks are in flight.', 'demo-parallel-parent-user-1')],
});

write(`${convParallel}.parallel.json`, `${JSON.stringify([
  {
    id: 'parallel-running',
    prompt: 'Keep scanning the layout regressions',
    childConversationId: 'demo-parallel-child-running',
    childSessionFile: join(dirname(convParallel), 'demo-parallel-child-running.jsonl'),
    status: 'running',
    createdAt: '2026-04-30T12:50:00.000Z',
    updatedAt: '2026-04-30T12:50:05.000Z',
    imageCount: 0,
    attachmentRefs: [],
    touchedFiles: ['packages/web/src/pages/ConversationPage.tsx'],
    parentTouchedFiles: [],
    overlapFiles: [],
    sideEffects: [],
    worktreeDirtyPathsAtStart: [],
  },
  {
    id: 'parallel-ready',
    prompt: 'Check the docs pass',
    childConversationId: 'demo-parallel-child-ready',
    childSessionFile: join(dirname(convParallel), 'demo-parallel-child-ready.jsonl'),
    status: 'ready',
    createdAt: '2026-04-30T12:50:10.000Z',
    updatedAt: '2026-04-30T12:51:00.000Z',
    imageCount: 1,
    attachmentRefs: ['whiteboard (rev 1)'],
    touchedFiles: ['docs/desktop-demo.md'],
    parentTouchedFiles: ['docs/desktop-demo.md'],
    overlapFiles: ['docs/desktop-demo.md'],
    sideEffects: ['Saved checkpoint abc1234 Keep the docs fix.'],
    worktreeDirtyPathsAtStart: [],
    resultText: 'The docs already cover this case.',
  },
], null, 2)}\n`);

writeSession({
  id: 'demo-attention',
  cwd: repoRoot,
  title: 'Look at the callback and reminder attention states',
  lines: [assistantText('demo-attention', 1, 'This thread should show unread attention and linked activity.', 'demo-attention-user-1')],
});

writeSession({
  id: 'demo-remote',
  cwd: repoRoot,
  title: 'Inspect the remote deployment helper',
  lines: [assistantText('demo-remote', 1, 'This conversation is linked to a remote host.', 'demo-remote-user-1')],
  fileName: '2026-04-30T13-10-00-000Z_demo-remote.jsonl',
});
const remoteFile = join(sessionsRoot, `--${repoRoot.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')}--`, '2026-04-30T13-10-00-000Z_demo-remote.jsonl');
write(remoteFile, [
  jsonLine({
    type: 'session',
    id: 'demo-remote',
    timestamp: '2026-04-30T13:10:00.000Z',
    cwd: repoRoot,
    remoteHostId: 'bender',
    remoteHostLabel: 'Bender',
    remoteConversationId: 'remote-thread-1',
  }),
  jsonLine({ type: 'model_change', modelId: 'gpt-5.4' }),
  jsonLine({ type: 'message', id: 'demo-remote-user-1', parentId: null, timestamp: '2026-04-30T13:10:00.000Z', message: { role: 'user', content: 'Inspect the remote deployment helper' } }),
  jsonLine({ type: 'message', id: 'demo-remote-assistant-1', parentId: 'demo-remote-user-1', timestamp: '2026-04-30T13:10:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'This conversation is linked to a remote host.' }] } }),
].join(''));

writeSession({
  id: 'demo-related-context',
  cwd: repoRoot,
  title: 'Reuse prior thread context for this task',
  lines: [
    customMessage(
      'demo-related-context',
      'related',
      'demo-related-context-user-1',
      'related_threads_context',
      [{ type: 'text', text: [
        'The user explicitly selected previous conversations to reuse as background context for the next prompt.',
        '',
        'Conversation 1 — Release signing',
        'Workspace: /repo/a',
        '',
        'Keep the notarization mapping fix.',
        '',
        'Conversation 2 — Auto mode wakeups',
        'Workspace: /repo/b',
        '',
        'Wakeups use durable run callbacks.',
      ].join('\n') }],
      {},
      false,
      '2026-04-30T13:20:01.000Z',
    ),
    assistantText('demo-related-context', 1, 'I reused the selected thread summaries before responding.', 'demo-related-context-related', '2026-04-30T13:20:02.000Z'),
  ],
});

write(join(stateRoot, 'desktop', 'daemon-offline-demo.json'), JSON.stringify({
  warnings: [
    'Daemon service is installed but not running.',
    'Daemon runtime is not responding on the local socket.',
  ],
  service: {
    platform: 'darwin',
    identifier: 'personal-agent-daemon',
    manifestPath: '/tmp/personal-agent-daemon.plist',
    installed: true,
    running: false,
    logFile: '/tmp/personal-agentd.log',
  },
  runtime: {
    running: false,
    socketPath: '/tmp/runtime.sock',
    moduleCount: 0,
  },
  log: {
    path: '/tmp/personal-agentd.log',
    lines: [],
  },
}, null, 2) + '\n');

saveConversationArtifact({
  stateRoot,
  profile: demoProfile,
  conversationId: 'demo-rich',
  artifactId: 'desktop-demo-report',
  title: 'Desktop demo report',
  kind: 'html',
  content: '<!doctype html><html><body><h1>Desktop demo</h1><p>Seeded artifact for UI validation.</p></body></html>',
  createdAt: now,
  updatedAt: now,
});

saveConversationAttachment({
  stateRoot,
  profile: demoProfile,
  conversationId: 'demo-rich',
  attachmentId: 'whiteboard',
  kind: 'excalidraw',
  title: 'Architecture sketch',
  sourceData: Buffer.from('{"type":"excalidraw","elements":[]}', 'utf-8').toString('base64'),
  sourceName: 'architecture.excalidraw',
  sourceMimeType: 'application/json',
  previewData: Buffer.from('demo-preview', 'utf-8').toString('base64'),
  previewName: 'architecture.png',
  previewMimeType: 'image/png',
  createdAt: now,
  updatedAt: now,
});

saveConversationCommitCheckpoint({
  stateRoot,
  profile: demoProfile,
  conversationId: 'demo-rich',
  checkpointId: 'abc1234',
  title: 'feat: seed desktop demo environment',
  cwd: repoRoot,
  commitSha: 'abc1234deadbeefabc1234deadbeefabc12345',
  shortSha: 'abc1234',
  subject: 'feat: seed desktop demo environment',
  authorName: 'Personal Agent',
  authorEmail: 'demo@local',
  committedAt: now,
  createdAt: now,
  updatedAt: now,
  files: [
    {
      path: 'scripts/desktop-demo.mjs',
      status: 'added',
      additions: 220,
      deletions: 0,
      patch: '@@\n+ seeded desktop demo environment\n',
    },
  ],
  linesAdded: 220,
  linesDeleted: 0,
  comments: [],
});

createStoredAutomation({
  profile: demoProfile,
  id: 'demo-daily-summary',
  title: 'Daily repo summary',
  enabled: true,
  cron: '0 9 * * 1-5',
  prompt: 'Summarize changes in the repo and highlight anything risky.',
  targetType: 'background-agent',
  cwd: repoRoot,
  modelRef: 'openai-codex/gpt-5.4',
});

createStoredAutomation({
  profile: demoProfile,
  id: 'demo-follow-up-thread',
  title: 'Resume demo-rich later',
  enabled: true,
  at: '2026-05-01T15:00:00.000Z',
  prompt: 'Follow up on the desktop demo polish pass.',
  targetType: 'conversation',
  conversationBehavior: 'followUp',
  cwd: repoRoot,
  threadMode: 'existing',
  threadConversationId: 'demo-rich',
});

createStoredAutomation({
  profile: demoProfile,
  id: 'demo-failed-automation',
  title: 'Broken nightly sync',
  enabled: true,
  cron: '30 2 * * *',
  prompt: 'Run the nightly sync and report failures.',
  targetType: 'background-agent',
  cwd: repoRoot,
  modelRef: 'openai-codex/gpt-5.4-mini',
});

const waitingRunPaths = resolveDurableRunPaths(runsRoot, 'run-demo-review');
saveDurableRunManifest(waitingRunPaths.manifestPath, createDurableRunManifest({
  id: 'run-demo-review',
  kind: 'background-run',
  resumePolicy: 'manual',
  createdAt: now,
  source: { type: 'background-run', id: 'demo-review' },
  spec: { task: 'Review demo environment' },
}));
saveDurableRunStatus(waitingRunPaths.statusPath, createInitialDurableRunStatus({
  runId: 'run-demo-review',
  status: 'waiting',
  createdAt: now,
  updatedAt: '2026-04-30T12:10:00.000Z',
  activeAttempt: 1,
  startedAt: '2026-04-30T12:01:00.000Z',
}));
saveDurableRunCheckpoint(waitingRunPaths.checkpointPath, {
  version: 1,
  runId: 'run-demo-review',
  updatedAt: '2026-04-30T12:09:30.000Z',
  step: 'Inspecting Context Rail attention states',
  cursor: 'rail.attention.review',
  payload: { note: 'Waiting on manual review' },
});

const completedRunPaths = resolveDurableRunPaths(runsRoot, 'run-demo-tests');
saveDurableRunManifest(completedRunPaths.manifestPath, createDurableRunManifest({
  id: 'run-demo-tests',
  kind: 'raw-shell',
  resumePolicy: 'rerun',
  createdAt: now,
  source: { type: 'tool', id: 'run' },
  spec: { command: 'npm test' },
}));
saveDurableRunStatus(completedRunPaths.statusPath, createInitialDurableRunStatus({
  runId: 'run-demo-tests',
  status: 'completed',
  createdAt: now,
  updatedAt: '2026-04-30T12:20:00.000Z',
  activeAttempt: 1,
  startedAt: '2026-04-30T12:02:00.000Z',
  completedAt: '2026-04-30T12:20:00.000Z',
}));

const failedRunPaths = resolveDurableRunPaths(runsRoot, 'run-demo-failed');
saveDurableRunManifest(failedRunPaths.manifestPath, createDurableRunManifest({
  id: 'run-demo-failed',
  kind: 'scheduled-task',
  resumePolicy: 'rerun',
  createdAt: now,
  source: { type: 'scheduled-task', id: 'demo-failed-automation' },
  spec: { taskId: 'demo-failed-automation' },
}));
saveDurableRunStatus(failedRunPaths.statusPath, createInitialDurableRunStatus({
  runId: 'run-demo-failed',
  status: 'failed',
  createdAt: now,
  updatedAt: '2026-04-30T12:30:00.000Z',
  activeAttempt: 1,
  startedAt: '2026-04-30T12:25:00.000Z',
  completedAt: '2026-04-30T12:30:00.000Z',
  lastError: 'Command exited with status 1',
}));

const deferredState = createEmptyDeferredResumeState();
deferredState.resumes['resume-demo-reminder'] = {
  id: 'resume-demo-reminder',
  sessionFile: convReminder,
  prompt: 'Check the onboarding flow now.',
  dueAt: '2026-05-01T18:00:00.000Z',
  createdAt: now,
  attempts: 0,
  status: 'scheduled',
  kind: 'reminder',
  title: 'Onboarding follow-up',
  behavior: 'followUp',
  delivery: { alertLevel: 'disruptive', autoResumeIfOpen: true, requireAck: true },
};
deferredState.resumes['resume-demo-callback'] = {
  id: 'resume-demo-callback',
  sessionFile: convReminder,
  prompt: 'Background task information-architecture-eval completed. Tell the user the background task finished in one short sentence.',
  dueAt: '2026-04-30T12:35:00.000Z',
  createdAt: now,
  attempts: 1,
  status: 'ready',
  readyAt: '2026-04-30T12:35:00.000Z',
  kind: 'task-callback',
  title: 'Background task information-architecture-eval completed',
  behavior: 'followUp',
  delivery: { alertLevel: 'disruptive', autoResumeIfOpen: true, requireAck: true },
  source: { kind: 'background-run', id: 'run-demo-review' },
};
saveDeferredResumeState(deferredState);

markConversationAttentionUnread({
  stateRoot,
  profile: demoProfile,
  conversationId: 'demo-attention',
  messageCount: 3,
  updatedAt: '2026-04-30T12:45:00.000Z',
});

writeProfileActivityEntry({
  stateRoot,
  profile: demoProfile,
  entry: createProjectActivityEntry({
    id: 'demo-activity-1',
    createdAt: '2026-04-30T12:44:00.000Z',
    profile: demoProfile,
    kind: 'conversation-reminder',
    summary: 'Reminder is waiting for acknowledgement.',
    details: 'The onboarding follow-up reminder is ready and marked disruptive.',
    notificationState: 'queued',
  }),
});
setActivityConversationLinks({
  stateRoot,
  profile: demoProfile,
  activityId: 'demo-activity-1',
  relatedConversationIds: ['demo-attention'],
  updatedAt: '2026-04-30T12:44:00.000Z',
});

const demoUiPreferences = {
  ui: {
    openConversationIds: ['demo-rich', 'demo-reminder', 'demo-parallel-parent'],
    pinnedConversationIds: ['demo-remote'],
    archivedConversationIds: ['demo-empty'],
    workspacePaths: [repoRoot],
  },
};
write(runtimeSettingsFile, JSON.stringify(demoUiPreferences, null, 2) + '\n');
write(localSettingsFile, JSON.stringify(demoUiPreferences, null, 2) + '\n');
mkdirp(desktopUserDataDir);

const envFile = join(stateRoot, 'desktop-demo-env.sh');
write(envFile, [
  `export PERSONAL_AGENT_STATE_ROOT=${JSON.stringify(stateRoot)}`,
  `export PERSONAL_AGENT_CONFIG_ROOT=${JSON.stringify(configRoot)}`,
  `export PERSONAL_AGENT_VAULT_ROOT=${JSON.stringify(vaultRoot)}`,
  `export PERSONAL_AGENT_PROFILE=${JSON.stringify(demoProfile)}`,
  `export PERSONAL_AGENT_ACTIVE_PROFILE=${JSON.stringify(demoProfile)}`,
  `export PERSONAL_AGENT_DESKTOP_INITIAL_ROUTE=${JSON.stringify(initialRoute)}`,
  `export PERSONAL_AGENT_DESKTOP_USER_DATA_DIR=${JSON.stringify(desktopUserDataDir)}`,
].join('\n') + '\n');

console.log(`Desktop demo state created at ${stateRoot}`);
console.log(`Env file: ${envFile}`);
console.log('Launch with:');
console.log(`  source ${envFile} && npm run desktop:start -- --no-quit-confirmation`);
console.log(`Initial route: ${initialRoute}`);
console.log('Seeded conversations: demo-empty, demo-normal, demo-tools, demo-running, demo-rich, demo-reminder, demo-auto-review, demo-parent, demo-subagent-child, demo-parallel-parent, demo-attention, demo-remote, demo-related-context');
console.log('Seeded automations: demo-daily-summary, demo-follow-up-thread, demo-failed-automation');
console.log('Seeded runs: run-demo-review, run-demo-tests, run-demo-failed');
console.log('Seeded deferred resumes: resume-demo-reminder, resume-demo-callback');
console.log('Extra pathological fixtures: daemon-offline snapshot, remote-linked conversation, related-context summary thread');
