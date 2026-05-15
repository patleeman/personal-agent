import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { listExtensionInstallSummaries } from './extensionRegistry.js';

const BACKEND_ACTION_SMOKE_SCRIPT = String.raw`
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const extensionId = process.argv[1];
const backendUrl = process.argv[2];
const repoRoot = process.argv[3];
const tempRoot = mkdtempSync(join(tmpdir(), 'pa-extension-runtime-smoke-' + extensionId + '-'));
const runtimeDir = join(tempRoot, 'runtime');
const vaultRoot = join(tempRoot, 'vault');
const stateRoot = join(tempRoot, 'state');
const configRoot = join(tempRoot, 'config');
const cwd = join(tempRoot, 'workspace');
const sessionFile = join(tempRoot, 'session.json');

mkdirSync(runtimeDir, { recursive: true });
mkdirSync(vaultRoot, { recursive: true });
mkdirSync(stateRoot, { recursive: true });
mkdirSync(configRoot, { recursive: true });
mkdirSync(cwd, { recursive: true });
writeFileSync(join(vaultRoot, 'smoke.md'), '# Smoke\n');
writeFileSync(sessionFile, JSON.stringify({ id: 'smoke-session', entries: [] }, null, 2));

process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
process.env.PERSONAL_AGENT_CONFIG_ROOT = configRoot;
process.env.PERSONAL_AGENT_VAULT_ROOT = vaultRoot;
process.env.PI_OPENAI_NATIVE_COMPACTION = '1';

const module = await import(backendUrl);
const storage = new Map();
const invalidatedTopics = [];
const conversations = [];
const registeredTools = [];
const registeredCommands = [];
const registeredEvents = [];
const appendedEntries = [];
const sentMessages = [];

const ctx = {
  extensionId,
  profile: 'shared',
  runtimeDir,
  profileSettingsFilePath: join(tempRoot, 'profile-settings.json'),
  toolContext: {
    conversationId: 'smoke-conversation',
    sessionId: 'smoke-session',
    sessionFile,
    cwd,
    preferredVisionModel: 'test-provider:test-model',
  },
  ui: {
    invalidate(topics) {
      invalidatedTopics.push(topics);
    },
    notify() {},
  },
  log: {
    info() {},
    warn() {},
    error() {},
    debug() {},
  },
  shell: {
    async exec(input) {
      if (input.command === 'sh' && Array.isArray(input.args) && input.args[0] === '-lc') {
        return { stdout: input.args[1] + '\n', stderr: '', executionWrappers: [] };
      }
      return { stdout: 'ok\n', stderr: '', executionWrappers: [] };
    },
    async spawn() {
      return { pid: 12345, executionWrappers: [], kill() {} };
    },
  },
  secrets: {
    get() {
      return undefined;
    },
  },
  storage: {
    async get(key) {
      return storage.get(key);
    },
    async put(key, value) {
      storage.set(key, value);
    },
    async delete(key) {
      storage.delete(key);
    },
  },
  extensions: {
    setEnabled() {},
  },
  conversations: {
    async create(input) {
      const conversation = { id: 'smoke-created-' + (conversations.length + 1), ...input };
      conversations.push(conversation);
      return conversation;
    },
    async setTitle() {},
    async appendVisibleCustomMessage() {},
  },
  runtime: {
    getRepoRoot() {
      return repoRoot;
    },
    getLiveSessionResourceOptions() {
      return { cwd, additionalSkillPaths: [] };
    },
  },
  agentToolContext: {
    cwd,
    sessionManager: {
      getSessionId: () => 'smoke-session',
      getSessionFile: () => sessionFile,
      getCwd: () => cwd,
    },
  },
};

const pi = {
  registerTool(tool) {
    registeredTools.push(tool);
  },
  registerCommand(command, handler) {
    registeredCommands.push({ command, handler });
  },
  on(eventName, handler) {
    registeredEvents.push({ eventName, handler });
  },
  appendEntry(customType, data) {
    appendedEntries.push({ customType, data });
  },
  sendUserMessage(message) {
    sentMessages.push({ type: 'user', message });
  },
  sendMessage(message) {
    sentMessages.push({ type: 'assistant', message });
  },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectReject(run, pattern) {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(pattern.test(message), 'Unexpected rejection for ' + extensionId + ': ' + message);
    return;
  }
  throw new Error(extensionId + ' smoke expected a validation error');
}

async function smokeAgentFactory(exportName) {
  const factory = exportName === 'default' ? module.default : module[exportName];
  assert(typeof factory === 'function', extensionId + ': missing agent factory ' + exportName);
  const registration = factory(pi);
  if (typeof registration === 'function') {
    registration(pi);
  }
  assert(registeredTools.length + registeredCommands.length + registeredEvents.length > 0, extensionId + ': agent factory registered nothing');
}

const smokes = {
  async 'system-artifacts'() {
    const result = await module.artifact({ action: 'list' }, ctx);
    assert(result.action === 'list', 'artifact list did not return list action');
  },
  async 'system-auto-mode'() {
    await smokeAgentFactory('createConversationAutoModeAgentExtension');
    const setGoal = registeredTools.find((tool) => tool.name === 'set_goal');
    assert(setGoal?.execute, 'set_goal tool was not registered');
    const result = await setGoal.execute('smoke', { objective: 'smoke test goal' }, undefined, undefined, ctx.agentToolContext);
    assert(result?.content?.[0]?.text?.includes('Goal set'), 'set_goal did not execute');
  },
  async 'system-automations'() {
    const result = await module.conversationQueue({ action: 'list' }, ctx);
    assert(result.action === 'list', 'conversation queue list did not return list action');
  },
  async 'system-alleycat'() {
    const result = await module.status({}, ctx);
    assert(result.running === false, 'alleycat status should not auto-start service');
    assert(result.agents.length === 1 && result.agents[0].name === 'personal-agent', 'alleycat should advertise only Personal Agent');
  },
  async 'system-browser'() {
    await smokeAgentFactory('createWorkbenchBrowserAgentExtension');
    const snapshot = registeredTools.find((tool) => tool.name === 'browser_snapshot');
    assert(snapshot?.execute, 'browser_snapshot tool was not registered');
    const result = await snapshot.execute('smoke', {}, undefined, undefined, ctx.agentToolContext);
    assert(result?.isError === true, 'browser_snapshot should report unavailable desktop host in smoke');
  },
  async 'system-conversation-tools'() {
    const result = await module.copyConversationId({ conversationId: 'smoke-conversation' }, ctx);
    assert(result.ok === true && result.conversationId === 'smoke-conversation', 'copyConversationId failed');
  },
  async 'system-diffs'() {
    const result = await module.checkpoint({ action: 'list' }, ctx);
    assert(result.action === 'list', 'checkpoint list did not return list action');
  },
  async 'system-extension-manager'() {
    const result = await module.listHostViewComponents({}, ctx);
    assert(result.ok === true && Array.isArray(result.hostViewComponents), 'host component list failed');
  },
  async 'system-image-probe'() {
    await expectReject(() => module.probeImage({ imageIds: [], question: 'what is this?' }, ctx), /at least one image ID/i);
  },
  async 'system-images'() {
    await expectReject(() => module.image({ prompt: 'draw smoke' }, { ...ctx, agentToolContext: undefined }), /active agent tool context/i);
  },
  async 'system-knowledge'() {
    const list = await module.vaultListFiles();
    assert(list.root === vaultRoot && Array.isArray(list.files), 'vaultListFiles failed');
    const refs = await module.resolvePromptReferences({ text: '@smoke.md' });
    assert(Array.isArray(refs.contextBlocks), 'resolvePromptReferences failed');
  },
  async 'system-local-dictation'() {
    const result = await module.readSettings({}, ctx);
    assert(result && typeof result === 'object', 'readSettings failed');
  },
  async 'system-mcp'() {
    const result = module.inspectMcpSettings({}, ctx);
    assert(Array.isArray(result.servers) && Array.isArray(result.searchedPaths), 'inspectMcpSettings failed');
  },
  async 'system-onboarding'() {
    const result = await module.ensure({}, ctx);
    assert(result.created === true && conversations.length === 1, 'onboarding ensure failed');
  },
  async 'system-openai-native-compaction'() {
    await smokeAgentFactory('default');
    assert(registeredEvents.some((event) => event.eventName === 'session_before_compact'), 'native compaction hooks missing');
  },
  async 'system-runs'() {
    const result = await module.bash({ command: 'echo smoke' }, ctx);
    assert(result.text.includes('echo smoke'), 'bash smoke did not execute shell stub');
  },
  async 'system-suggested-context'() {
    const result = await module.warmPointers({ prompt: 'smoke test prompt', currentConversationId: 'smoke-conversation', currentCwd: cwd }, ctx);
    assert(result.ok === true && typeof result.pointerCount === 'number', 'warmPointers failed');
  },
  async 'system-telemetry'() {
    const result = await module.summary({ query: {} });
    assert(result.status === 200 && result.body, 'telemetry summary failed');
  },
  async 'system-web-tools'() {
    const result = await module.webFetch({ url: 'data:text/plain,smoke' }, ctx);
    assert(result.text.includes('smoke'), 'webFetch data URL failed');
  },
};

const smoke = smokes[extensionId];
assert(smoke, 'No runtime smoke registered for ' + extensionId);
await smoke();
`;

function runBackendRuntimeSmoke(extensionId: string, backendPath: string) {
  execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', BACKEND_ACTION_SMOKE_SCRIPT, extensionId, pathToFileURL(backendPath).href, process.cwd()],
    {
      encoding: 'utf-8',
      timeout: 30000,
      env: {
        ...process.env,
        PERSONAL_AGENT_REPO_ROOT: process.cwd(),
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=1024`.trim(),
      },
    },
  );
}

describe('system extension backend runtime smoke tests', () => {
  const systemBackends = listExtensionInstallSummaries()
    .filter(
      (summary) =>
        summary.packageType === 'system' &&
        summary.manifest.backend?.entry &&
        (summary.packageRoot ?? '').startsWith(resolve(process.cwd(), 'extensions/system-')),
    )
    .map((summary) => ({ id: summary.id, backendPath: resolve(summary.packageRoot ?? '', 'dist', 'backend.mjs') }))
    .sort((left, right) => left.id.localeCompare(right.id));

  it('has a smoke case for every system extension backend', () => {
    const smokeIds = new Set([...BACKEND_ACTION_SMOKE_SCRIPT.matchAll(/async '([^']+)'\(/g)].map((match) => match[1]));
    expect(
      systemBackends.map((backend) => backend.id).filter((id) => !smokeIds.has(id)),
      'Missing system extension backend runtime smoke cases',
    ).toEqual([]);
  });

  it('imports each prebuilt backend and exercises one safe runtime path', () => {
    if (process.env.QUICK_EXTENSION_CHECK) {
      console.log('  ↳ skipped (QUICK_EXTENSION_CHECK=1 — run without it for full runtime smoke)');
      return;
    }

    for (const backend of systemBackends) {
      expect(existsSync(backend.backendPath), `${backend.id}: missing dist/backend.mjs`).toBe(true);
      expect(() => runBackendRuntimeSmoke(backend.id, backend.backendPath), `${backend.id}: backend runtime smoke failed`).not.toThrow();
    }
  }, 120000);
});
