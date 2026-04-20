#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '..');
const stateRoot = process.env.PA_IOS_DEV_STATE_ROOT?.trim() || '/tmp/personal-agent-ios-dev-state';
const derivedDataPath = process.env.PA_IOS_DERIVED_DATA_PATH?.trim() || '/tmp/personal-agent-ios-deriveddata';
const hostPort = Number.parseInt(process.env.PA_IOS_DEV_PORT?.trim() || '3845', 10);
const hostBaseUrl = process.env.PA_IOS_DEV_BASE_URL?.trim() || `http://127.0.0.1:${String(hostPort)}`;
const hostMetadataFile = process.env.PA_IOS_DEV_METADATA_FILE?.trim() || '/tmp/personal-agent-ios-dev-host.json';
const liveConfigFile = process.env.PA_IOS_LIVE_COMPANION_CONFIG_FILE?.trim() || '/tmp/personal-agent-ios-live-test-config.json';
const demoSnapshotFile = resolve(repoRoot, 'apps/ios/PersonalAgentCompanion/demo-data/local-transcripts.json');
const simulatorDevice = process.env.PA_IOS_SIMULATOR_DEVICE?.trim() || 'iPhone 17 Pro';
const bundleId = process.env.PA_IOS_BUNDLE_ID?.trim() || 'com.personalagent.ios.companion';
const projectPath = resolve(repoRoot, 'apps/ios/PersonalAgentCompanion/PersonalAgentCompanion.xcodeproj');
const scheme = 'PersonalAgentCompanion';
const appPath = join(derivedDataPath, 'Build/Products/Debug-iphonesimulator/PersonalAgentCompanion.app');
const repoEnvPath = resolve(repoRoot, '.env');
const defaultEnvPath = resolve(homedir(), 'workingdir', 'familiar', '.env');
const localExecutionTarget = { id: 'local', label: 'Local', kind: 'local' };

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: repoRoot,
    env: process.env,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status ?? 1)}`);
  }
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    cwd: repoRoot,
    env: process.env,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || `${command} ${args.join(' ')} failed`);
  }
  return result.stdout?.trim() || '';
}

async function importBuiltModule(relativePath) {
  const fullPath = resolve(repoRoot, relativePath);
  return import(pathToFileURL(fullPath).href);
}

function ensureBuildArtifacts() {
  const required = [
    'packages/core/dist/index.js',
    'packages/daemon/dist/index.js',
    'packages/web/dist-server/app/localApi.js',
  ];
  const missing = required.filter((relativePath) => !existsSync(resolve(repoRoot, relativePath)));
  if (missing.length > 0) {
    fail(`Missing build artifacts:\n${missing.map((entry) => `- ${entry}`).join('\n')}\nRun \`npm run ios:dev:prepare\` first.`);
  }
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
  });
  const text = await response.text();
  const body = text.trim().length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body && typeof body === 'object' && typeof body.error === 'string'
      ? body.error
      : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return body;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function parseEnvFile(content) {
  const parsed = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    let value = normalized.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function loadDevEnvDefaults() {
  if (process.env.PA_IOS_DEV_ENV_LOADED === '1') {
    return;
  }

  for (const envPath of [repoEnvPath, defaultEnvPath]) {
    if (!envPath || !existsSync(envPath)) {
      continue;
    }
    const parsed = parseEnvFile(readFileSync(envPath, 'utf-8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    log(`Loaded iOS dev env defaults from ${envPath}`);
    break;
  }

  process.env.PA_IOS_DEV_ENV_LOADED = '1';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonResponseBody(response) {
  const text = Buffer.from(response.body ?? new Uint8Array()).toString('utf-8').trim();
  return text.length > 0 ? JSON.parse(text) : null;
}

function readDispatchError(response) {
  try {
    const body = parseJsonResponseBody(response);
    if (body && typeof body === 'object' && typeof body.error === 'string') {
      return body.error;
    }
  } catch {
    // Ignore JSON parse failures.
  }

  try {
    const text = Buffer.from(response.body ?? new Uint8Array()).toString('utf-8').trim();
    if (text.length > 0) {
      return text;
    }
  } catch {
    // Ignore binary responses.
  }

  return `Request failed with status ${String(response.statusCode)}`;
}

function parseDataUrlAsset(input) {
  const dataUrl = typeof input?.dataUrl === 'string' ? input.dataUrl.trim() : '';
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/i.exec(dataUrl);
  if (!match) {
    throw new Error('Attachment asset payload is malformed.');
  }

  return {
    data: Buffer.from(match[2] || '', 'base64'),
    mimeType: typeof input?.mimeType === 'string' && input.mimeType.trim().length > 0
      ? input.mimeType.trim()
      : 'application/octet-stream',
    ...(typeof input?.fileName === 'string' && input.fileName.trim().length > 0
      ? { fileName: input.fileName.trim() }
      : {}),
    disposition: 'inline',
  };
}

function toQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.length > 0) {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

function clipString(value, limit = 2400) {
  if (typeof value !== 'string') {
    return value;
  }
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function sanitizeBlockForDemo(block) {
  const next = {
    ...block,
    text: clipString(block.text, 900),
    title: clipString(block.title, 200),
    detail: clipString(block.detail, 900),
    output: clipString(block.output, 1200),
    message: clipString(block.message, 900),
    alt: clipString(block.alt, 200),
    caption: clipString(block.caption, 240),
  };

  if (typeof next.src === 'string' && next.src.startsWith('data:')) {
    next.src = undefined;
  }
  if (Array.isArray(next.images)) {
    next.images = next.images.slice(0, 4).map((image) => ({
      ...image,
      alt: clipString(image.alt, 200),
      caption: clipString(image.caption, 240),
      src: typeof image.src === 'string' && image.src.startsWith('data:') ? undefined : image.src,
    }));
  }

  return next;
}

function sanitizeSessionForDemo(session) {
  return {
    ...session,
    title: clipString(session.title, 140),
    cwd: clipString(session.cwd, 240),
    cwdSlug: clipString(session.cwdSlug, 80),
    model: clipString(session.model, 80),
  };
}

function massageDemoBlocks(blocks) {
  const next = [...blocks];
  const toolUseCount = next.filter((block) => block?.type === 'tool_use').length;
  const last = next.at(-1);
  if (toolUseCount >= 3 && last?.type === 'text' && typeof last.text === 'string' && last.text.length > 220) {
    next[next.length - 1] = {
      ...last,
      text: clipString(last.text, 220),
    };
  }
  return next;
}

function readSystemHostLabel() {
  for (const [command, args] of [
    ['scutil', ['--get', 'ComputerName']],
    ['hostname', []],
  ]) {
    try {
      const value = runCapture(command, args).trim();
      if (value.length > 0) {
        return value;
      }
    } catch {
      // Ignore lookup failures and fall through.
    }
  }
  return 'This Mac';
}

async function buildDeviceDemoSnapshot() {
  loadDevEnvDefaults();
  ensureBuildArtifacts();

  const core = await importBuiltModule('packages/core/dist/index.js');
  const localApi = await importBuiltModule('packages/web/dist-server/app/localApi.js');
  await core.hydrateProcessEnvFromShell?.();

  const sessions = await localApi.readDesktopSessions();
  const candidates = [];

  for (const [index, session] of sessions.slice(0, 12).entries()) {
    try {
      const response = await localApi.dispatchDesktopLocalApiRequest({
        method: 'GET',
        path: `/api/conversations/${encodeURIComponent(session.id)}/bootstrap?tailBlocks=32`,
      });
      if (response.statusCode < 200 || response.statusCode >= 300) {
        continue;
      }
      const body = parseJsonResponseBody(response);
      const detail = body?.sessionDetail ?? body?.bootstrap?.sessionDetail;
      const blocks = Array.isArray(detail?.blocks) ? massageDemoBlocks(detail.blocks.map(sanitizeBlockForDemo)) : [];
      if (blocks.length === 0) {
        continue;
      }
      candidates.push({
        index,
        sessionMeta: sanitizeSessionForDemo(body?.sessionMeta ?? detail?.meta ?? session),
        blocks,
        toolUseCount: blocks.filter((block) => block?.type === 'tool_use').length,
      });
    } catch {
      // Ignore unreadable sessions so a few bad conversations do not poison the demo seed.
    }
  }

  const selected = [...candidates]
    .sort((left, right) => {
      const toolDelta = (right.toolUseCount > 0 ? 1 : 0) - (left.toolUseCount > 0 ? 1 : 0);
      if (toolDelta !== 0) {
        return toolDelta;
      }
      if (right.toolUseCount !== left.toolUseCount) {
        return right.toolUseCount - left.toolUseCount;
      }
      return left.index - right.index;
    })
    .slice(0, 3)
    .map((entry) => ({
      sessionMeta: entry.sessionMeta,
      blocks: entry.blocks,
      toolUseCount: entry.toolUseCount,
    }));

  return {
    hostLabel: `${readSystemHostLabel()} Demo`,
    generatedAt: new Date().toISOString(),
    conversations: selected,
  };
}

async function createHeadlessCompanionRuntime(localApi) {
  async function invokeLocalApi(input) {
    const response = await localApi.dispatchDesktopLocalApiRequest(input);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(readDispatchError(response));
    }
    return parseJsonResponseBody(response);
  }

  return {
    async listConversations() {
      const [sessions, ordering] = await Promise.all([
        localApi.readDesktopSessions(),
        localApi.readDesktopOpenConversationTabs(),
      ]);
      return {
        sessions,
        ordering,
        executionTargets: [localExecutionTarget],
      };
    },

    async listExecutionTargets() {
      return { executionTargets: [localExecutionTarget] };
    },

    async readConversationBootstrap(input) {
      const query = toQuery({
        ...(typeof input.tailBlocks === 'number' ? { tailBlocks: String(input.tailBlocks) } : {}),
        ...(input.knownSessionSignature ? { knownSessionSignature: input.knownSessionSignature } : {}),
        ...(typeof input.knownBlockOffset === 'number' ? { knownBlockOffset: String(input.knownBlockOffset) } : {}),
        ...(typeof input.knownTotalBlocks === 'number' ? { knownTotalBlocks: String(input.knownTotalBlocks) } : {}),
        ...(input.knownLastBlockId ? { knownLastBlockId: input.knownLastBlockId } : {}),
      });

      const [bootstrap, sessionMeta, attachments] = await Promise.all([
        invokeLocalApi({
          method: 'GET',
          path: `/api/conversations/${encodeURIComponent(input.conversationId)}/bootstrap${query}`,
        }),
        localApi.readDesktopSessionMeta(input.conversationId).catch(() => null),
        localApi.readDesktopConversationAttachments(input.conversationId).catch(() => null),
      ]);

      return {
        bootstrap,
        sessionMeta,
        attachments,
        executionTargets: [localExecutionTarget],
      };
    },

    async createConversation(input) {
      if (input.executionTargetId && input.executionTargetId !== 'local') {
        throw new Error('The iOS dev host only supports the local execution target.');
      }

      const created = await localApi.createDesktopLiveSession({
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.thinkingLevel !== undefined ? { thinkingLevel: input.thinkingLevel } : {}),
        ...(input.serviceTier !== undefined ? { serviceTier: input.serviceTier } : {}),
      });

      const conversationId = created.id;
      if (input.prompt && (input.prompt.text?.trim() || (input.prompt.images?.length ?? 0) > 0 || (input.prompt.attachmentRefs?.length ?? 0) > 0)) {
        await localApi.submitDesktopLiveSessionPrompt({
          conversationId,
          ...(input.prompt.text !== undefined ? { text: input.prompt.text } : {}),
          ...(input.prompt.behavior ? { behavior: input.prompt.behavior } : {}),
          ...(input.prompt.images ? { images: input.prompt.images } : {}),
          ...(input.prompt.attachmentRefs ? { attachmentRefs: input.prompt.attachmentRefs } : {}),
          ...(input.prompt.contextMessages ? { contextMessages: input.prompt.contextMessages } : {}),
          ...(input.prompt.surfaceId ? { surfaceId: input.prompt.surfaceId } : {}),
        });
      }

      return this.readConversationBootstrap({ conversationId });
    },

    async resumeConversation(input) {
      if (input.executionTargetId && input.executionTargetId !== 'local') {
        throw new Error('The iOS dev host only supports the local execution target.');
      }

      const resumed = await localApi.resumeDesktopLiveSession({
        sessionFile: input.sessionFile,
        ...(input.cwd ? { cwd: input.cwd } : {}),
      });
      return this.readConversationBootstrap({ conversationId: resumed.id });
    },

    async promptConversation(input) {
      return localApi.submitDesktopLiveSessionPrompt({
        conversationId: input.conversationId,
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.behavior ? { behavior: input.behavior } : {}),
        ...(input.images ? { images: input.images } : {}),
        ...(input.attachmentRefs ? { attachmentRefs: input.attachmentRefs } : {}),
        ...(input.contextMessages ? { contextMessages: input.contextMessages } : {}),
        ...(input.surfaceId ? { surfaceId: input.surfaceId } : {}),
      });
    },

    async abortConversation(input) {
      return localApi.abortDesktopLiveSession(input.conversationId);
    },

    async takeOverConversation(input) {
      return localApi.takeOverDesktopLiveSession({
        conversationId: input.conversationId,
        surfaceId: input.surfaceId,
      });
    },

    async renameConversation(input) {
      return localApi.renameDesktopConversation({
        conversationId: input.conversationId,
        name: input.name,
        ...(input.surfaceId ? { surfaceId: input.surfaceId } : {}),
      });
    },

    async changeConversationExecutionTarget(input) {
      if (input.executionTargetId !== 'local') {
        throw new Error('The iOS dev host only supports the local execution target.');
      }
      return this.readConversationBootstrap({ conversationId: input.conversationId });
    },

    async listConversationAttachments(conversationId) {
      return localApi.readDesktopConversationAttachments(conversationId);
    },

    async readConversationAttachment(input) {
      return localApi.readDesktopConversationAttachment(input);
    },

    async createConversationAttachment(input) {
      return localApi.createDesktopConversationAttachment(input);
    },

    async updateConversationAttachment(input) {
      return localApi.updateDesktopConversationAttachment(input);
    },

    async readConversationAttachmentAsset(input) {
      return parseDataUrlAsset(await localApi.readDesktopConversationAttachmentAsset(input));
    },

    async subscribeApp(onEvent) {
      onEvent({ type: 'open' });
      return localApi.subscribeDesktopAppEvents((event) => {
        if (event.type === 'error') {
          onEvent({ type: 'error', message: event.message });
          return;
        }
        if (event.type === 'close') {
          onEvent({ type: 'close' });
          return;
        }
        if (event.type === 'open') {
          onEvent({ type: 'open' });
          return;
        }
        onEvent({ type: 'conversation_list_changed', sourceEvent: event.event });
      });
    },

    async subscribeConversation(input, onEvent) {
      const query = toQuery({
        ...(input.surfaceId ? { surfaceId: input.surfaceId } : {}),
        ...(input.surfaceType === 'ios_native' ? { surfaceType: 'mobile_web' } : {}),
        ...(typeof input.tailBlocks === 'number' ? { tailBlocks: String(input.tailBlocks) } : {}),
      });
      return localApi.subscribeDesktopLocalApiStream(
        `/api/live-sessions/${encodeURIComponent(input.conversationId)}/events${query}`,
        (event) => {
          if (event.type === 'message') {
            try {
              onEvent(JSON.parse(event.data || 'null'));
            } catch (error) {
              onEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) });
            }
            return;
          }
          if (event.type === 'error') {
            onEvent({ type: 'error', message: event.message });
            return;
          }
          if (event.type === 'close') {
            onEvent({ type: 'close' });
          }
        },
      );
    },
  };
}

async function createPairingCode(baseUrl) {
  const hello = await fetchJson(`${baseUrl}/companion/v1/hello`);
  const pairing = await fetchJson(`${baseUrl}/companion/v1/admin/pairing-codes`, { method: 'POST' });
  return { hello, pairing };
}

async function createFreshPairing(baseUrl, deviceLabel) {
  const { hello, pairing } = await createPairingCode(baseUrl);
  const paired = await fetchJson(`${baseUrl}/companion/v1/auth/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: pairing.code,
      deviceLabel,
    }),
  });

  return {
    hello,
    pairing,
    paired,
  };
}

function resolveSimulatorDeviceId(deviceName) {
  const raw = runCapture('xcrun', ['simctl', 'list', 'devices', 'available', '--json']);
  const parsed = JSON.parse(raw);
  const runtimes = Array.isArray(parsed.devices) ? parsed.devices : Object.values(parsed.devices || {});
  for (const runtimeDevices of runtimes) {
    if (!Array.isArray(runtimeDevices)) {
      continue;
    }
    const match = runtimeDevices.find((device) => device?.name === deviceName && device?.isAvailable !== false);
    if (match?.udid) {
      return String(match.udid);
    }
  }
  throw new Error(`Could not find an available simulator named ${deviceName}.`);
}

async function bootSimulator(device) {
  const deviceId = resolveSimulatorDeviceId(device);
  const bootResult = spawnSync('xcrun', ['simctl', 'boot', deviceId], { encoding: 'utf-8' });
  if (bootResult.status !== 0) {
    const output = `${bootResult.stdout || ''}\n${bootResult.stderr || ''}`;
    if (!/Booted|already booted|current state: Booted/i.test(output)) {
      throw new Error(output.trim() || `Could not boot simulator ${device}`);
    }
  }
  runChecked('xcrun', ['simctl', 'bootstatus', deviceId, '-b']);
  return deviceId;
}

async function buildInstallAndLaunchSimulator(input) {
  const deviceId = await bootSimulator(input.device);
  runChecked('xcodebuild', [
    'build',
    '-project', projectPath,
    '-scheme', scheme,
    '-destination', `id=${deviceId}`,
    '-derivedDataPath', derivedDataPath,
    'CODE_SIGNING_ALLOWED=NO',
  ]);

  await bootSimulator(input.device);
  if (input.resetAppState) {
    spawnSync('xcrun', ['simctl', 'uninstall', deviceId, bundleId], { stdio: 'ignore' });
  }
  runChecked('xcrun', ['simctl', 'install', deviceId, appPath]);
  spawnSync('xcrun', ['simctl', 'terminate', deviceId, bundleId], { stdio: 'ignore' });

  const launchEnv = {
    ...process.env,
    ...(input.baseURL ? { SIMCTL_CHILD_PA_IOS_DEFAULT_HOST: input.baseURL } : {}),
    ...(input.baseURL ? { SIMCTL_CHILD_PA_IOS_BOOTSTRAP_HOST_URL: input.baseURL } : {}),
    ...(input.bearerToken ? { SIMCTL_CHILD_PA_IOS_BOOTSTRAP_BEARER_TOKEN: input.bearerToken } : {}),
    ...(input.hostLabel ? { SIMCTL_CHILD_PA_IOS_BOOTSTRAP_HOST_LABEL: input.hostLabel } : {}),
    ...(input.hostInstanceId ? { SIMCTL_CHILD_PA_IOS_BOOTSTRAP_HOST_INSTANCE_ID: input.hostInstanceId } : {}),
    ...(input.deviceId ? { SIMCTL_CHILD_PA_IOS_BOOTSTRAP_DEVICE_ID: input.deviceId } : {}),
    ...(input.deviceLabel ? { SIMCTL_CHILD_PA_IOS_BOOTSTRAP_DEVICE_LABEL: input.deviceLabel } : {}),
    ...(input.extraLaunchEnv ?? {}),
  };
  runChecked('xcrun', ['simctl', 'launch', deviceId, bundleId], { env: launchEnv });
}

function createSetupUrl({ baseURL, code, hostLabel, hostInstanceId }) {
  const params = new URLSearchParams({
    base: baseURL,
    code,
    label: hostLabel,
    hostInstanceId,
  });
  return `pa-companion://pair?${params.toString()}`;
}

async function hostCommand() {
  loadDevEnvDefaults();
  ensureBuildArtifacts();
  process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
  process.env.PERSONAL_AGENT_DESKTOP_VARIANT = process.env.PERSONAL_AGENT_DESKTOP_VARIANT || 'testing';

  const core = await importBuiltModule('packages/core/dist/index.js');
  const daemonModule = await importBuiltModule('packages/daemon/dist/index.js');
  const localApi = await importBuiltModule('packages/web/dist-server/app/localApi.js');

  await core.hydrateProcessEnvFromShell?.();

  const runtime = await createHeadlessCompanionRuntime(localApi);
  const config = daemonModule.loadDaemonConfig();
  config.companion = {
    enabled: true,
    host: '127.0.0.1',
    port: hostPort,
  };

  const daemon = new daemonModule.PersonalAgentDaemon({
    config,
    stopRequestBehavior: 'stop-only',
    companionRuntimeProvider: async () => runtime,
    logSink: (line) => log(line),
  });

  await daemon.start();
  const hello = await fetchJson(`${hostBaseUrl}/companion/v1/hello`);
  writeJson(hostMetadataFile, {
    stateRoot,
    baseURL: hostBaseUrl,
    hostLabel: hello.hostLabel,
    hostInstanceId: hello.hostInstanceId,
    simulatorDevice,
    derivedDataPath,
    bundleId,
    startedAt: new Date().toISOString(),
  });

  log(`iOS dev companion host running at ${hostBaseUrl}`);
  log(`State root: ${stateRoot}`);
  log(`Metadata: ${hostMetadataFile}`);
  log('Use another terminal for:');
  log('  npm run ios:dev:sim');
  log('  npm run ios:demo');
  log('  npm run ios:dev:setup-url');
  log('  npm run ios:test:live');

  const shutdown = async () => {
    await daemon.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
  await new Promise(() => {});
}

async function simCommand() {
  loadDevEnvDefaults();
  const { hello, paired } = await createFreshPairing(hostBaseUrl, 'PersonalAgentCompanion Simulator');
  writeJson(hostMetadataFile, {
    stateRoot,
    baseURL: hostBaseUrl,
    hostLabel: hello.hostLabel,
    hostInstanceId: hello.hostInstanceId,
    simulatorDevice,
    derivedDataPath,
    bundleId,
    deviceId: paired.device.id,
    deviceLabel: paired.device.deviceLabel,
    pairedAt: new Date().toISOString(),
  });
  writeJson(liveConfigFile, {
    enabled: true,
    baseURL: hostBaseUrl,
    cwd: repoRoot,
    exercisePrompt: false,
  });

  await buildInstallAndLaunchSimulator({
    device: simulatorDevice,
    baseURL: hostBaseUrl,
    bearerToken: paired.bearerToken,
    hostLabel: hello.hostLabel,
    hostInstanceId: hello.hostInstanceId,
    deviceId: paired.device.id,
    deviceLabel: paired.device.deviceLabel,
  });

  log(`Simulator launched against ${hostBaseUrl}`);
  log(`Live test config written to ${liveConfigFile}`);
}

async function openSetupUrlCommand() {
  loadDevEnvDefaults();
  const { hello, pairing } = await createPairingCode(hostBaseUrl);
  const deviceId = await bootSimulator(simulatorDevice);
  const setupUrl = createSetupUrl({
    baseURL: hostBaseUrl,
    code: pairing.code,
    hostLabel: hello.hostLabel,
    hostInstanceId: hello.hostInstanceId,
  });
  runChecked('xcrun', ['simctl', 'openurl', deviceId, setupUrl]);
  log(`Opened setup URL in Simulator:`);
  log(setupUrl);
}

async function testLiveCommand() {
  loadDevEnvDefaults();
  const { pairing } = await createFreshPairing(hostBaseUrl, 'PersonalAgentCompanion XCTest');
  writeJson(liveConfigFile, {
    enabled: true,
    baseURL: hostBaseUrl,
    pairingCode: pairing.code,
    cwd: repoRoot,
    exercisePrompt: process.env.PA_IOS_LIVE_COMPANION_EXERCISE_PROMPT === '1',
  });

  const deviceId = await bootSimulator(simulatorDevice);
  runChecked('xcodebuild', [
    'test',
    '-project', projectPath,
    '-scheme', scheme,
    '-destination', `id=${deviceId}`,
    '-only-testing:PersonalAgentCompanionTests/PersonalAgentCompanionTests/testLiveSetupURLPairsAgainstDesktopHost',
    '-only-testing:PersonalAgentCompanionTests/PersonalAgentCompanionTests/testLiveCompanionRoundTripAgainstDesktopHost',
    'CODE_SIGNING_ALLOWED=NO',
  ], {
    env: {
      ...process.env,
      PA_IOS_LIVE_COMPANION_CONFIG_FILE: liveConfigFile,
    },
  });
}

async function demoRefreshCommand() {
  const snapshot = await buildDeviceDemoSnapshot();
  writeJson(demoSnapshotFile, snapshot);
  log(`Wrote iOS demo transcripts to ${demoSnapshotFile}`);
  if (!Array.isArray(snapshot.conversations) || snapshot.conversations.length === 0) {
    log('No local transcripts were available, so the demo will fall back to the built-in sample data.');
    return;
  }
  for (const conversation of snapshot.conversations) {
    log(`- ${conversation.sessionMeta.title} (${conversation.toolUseCount} tool call${conversation.toolUseCount === 1 ? '' : 's'})`);
  }
}

async function launchDemo({ openConversation = false, startRunningConversation = false } = {}) {
  await buildInstallAndLaunchSimulator({
    device: simulatorDevice,
    resetAppState: true,
    extraLaunchEnv: {
      SIMCTL_CHILD_PA_IOS_MOCK_MODE: '1',
      SIMCTL_CHILD_PA_IOS_USE_DEVICE_DEMO_DATA: '1',
      SIMCTL_CHILD_PA_IOS_AUTO_CONNECT_MOCK_HOST: '1',
      ...(openConversation ? { SIMCTL_CHILD_PA_IOS_AUTO_OPEN_FIRST_MOCK_CONVERSATION: '1' } : {}),
      ...(startRunningConversation ? { SIMCTL_CHILD_PA_IOS_AUTO_START_MOCK_RUNNING: '1' } : {}),
      SIMCTL_CHILD_PA_IOS_DEMO_SNAPSHOT_FILE: demoSnapshotFile,
    },
  });
}

async function demoCommand() {
  loadDevEnvDefaults();
  await demoRefreshCommand();
  await launchDemo();
  log(`Simulator launched in demo mode using ${demoSnapshotFile}`);
}

async function demoRunningCommand() {
  loadDevEnvDefaults();
  await demoRefreshCommand();
  await launchDemo({ openConversation: true, startRunningConversation: true });
  log(`Simulator launched in running-demo mode using ${demoSnapshotFile}`);
}

async function prepareCommand() {
  loadDevEnvDefaults();
  runChecked('npm', ['--prefix', 'packages/core', 'run', 'build']);
  runChecked('npm', ['--prefix', 'packages/daemon', 'run', 'build']);
  runChecked('npm', ['--prefix', 'packages/web', 'run', 'build']);
}

async function devCommand() {
  loadDevEnvDefaults();
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'host'], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });

  const stopChild = () => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  };
  process.on('SIGINT', stopChild);
  process.on('SIGTERM', stopChild);

  try {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      try {
        await fetchJson(`${hostBaseUrl}/companion/v1/hello`);
        break;
      } catch {
        if (child.exitCode !== null) {
          throw new Error('The local iOS dev host exited before it became ready.');
        }
        await sleep(1000);
      }
    }

    await simCommand();
    log('Local iOS dev host is still running. Press Ctrl+C to stop it.');
    await new Promise((resolve, reject) => {
      child.on('exit', (code, signal) => {
        if (signal === 'SIGTERM' || code === 0 || code === null) {
          resolve();
          return;
        }
        reject(new Error(`The local iOS dev host exited with ${signal ?? `code ${String(code)}`}.`));
      });
    });
  } finally {
    process.off('SIGINT', stopChild);
    process.off('SIGTERM', stopChild);
    stopChild();
  }
}

const command = process.argv[2]?.trim();

try {
  switch (command) {
    case 'prepare':
      await prepareCommand();
      break;
    case 'host':
      await hostCommand();
      break;
    case 'sim':
      await simCommand();
      break;
    case 'dev':
      await devCommand();
      break;
    case 'demo-refresh':
      await demoRefreshCommand();
      break;
    case 'demo':
      await demoCommand();
      break;
    case 'demo-running':
      await demoRunningCommand();
      break;
    case 'open-setup-url':
      await openSetupUrlCommand();
      break;
    case 'test-live':
      await testLiveCommand();
      break;
    default:
      log('Usage: node scripts/ios-dev.mjs <prepare|host|sim|dev|demo-refresh|demo|demo-running|open-setup-url|test-live>');
      process.exit(command ? 1 : 0);
  }

  if (command && command !== 'host' && command !== 'dev') {
    process.exit(0);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
