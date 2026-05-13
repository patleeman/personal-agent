import type { MethodHandler } from '../server.js';

/**
 * Stub handlers for Codex API methods that don't have PA equivalents.
 * These return empty/not-implemented responses to avoid client errors
 * when companion apps or other Codex clients call them.
 */

function notImplemented(method: string): MethodHandler {
  return async (_params, _ctx, _conn, _notify) => {
    return { status: 'not_implemented', method, message: `${method} is not implemented on Personal Agent` };
  };
}

// ── Thread experimental features ────────────────────────────────────────────

export const threadRealtime = {
  start: notImplemented('thread/realtime/start') as MethodHandler,
  stop: notImplemented('thread/realtime/stop') as MethodHandler,
  appendAudio: notImplemented('thread/realtime/appendAudio') as MethodHandler,
  appendText: notImplemented('thread/realtime/appendText') as MethodHandler,
};

export const threadBackgroundTerminals = {
  clean: notImplemented('thread/backgroundTerminals/clean') as MethodHandler,
};

export const threadMemoryMode = {
  set: notImplemented('thread/memoryMode/set') as MethodHandler,
};

// ── Process (standalone) ───────────────────────────────────────────────────

export const processStubs = {
  spawn: notImplemented('process/spawn') as MethodHandler,
  writeStdin: notImplemented('process/writeStdin') as MethodHandler,
  resizePty: notImplemented('process/resizePty') as MethodHandler,
  kill: notImplemented('process/kill') as MethodHandler,
};

// ── File watching ──────────────────────────────────────────────────────────

export const fsWatch = {
  watch: notImplemented('fs/watch') as MethodHandler,
  unwatch: notImplemented('fs/unwatch') as MethodHandler,
};

// ── Model provider ─────────────────────────────────────────────────────────

export const modelProvider = {
  capabilitiesRead: notImplemented('modelProvider/capabilities/read') as MethodHandler,
};

// ── Experimental features ──────────────────────────────────────────────────

export const experimentalFeature = {
  list: (async () => ({ data: [] })) as MethodHandler,
  enablementSet: notImplemented('experimentalFeature/enablement/set') as MethodHandler,
};

// ── Hooks ──────────────────────────────────────────────────────────────────

export const hooksList = (async () => ({ data: [] })) as MethodHandler;

// ── Marketplace ────────────────────────────────────────────────────────────

export const marketplace = {
  add: notImplemented('marketplace/add') as MethodHandler,
  remove: notImplemented('marketplace/remove') as MethodHandler,
  upgrade: notImplemented('marketplace/upgrade') as MethodHandler,
};

// ── Plugins ────────────────────────────────────────────────────────────────

export const plugin = {
  list: (async () => ({ data: [] })) as MethodHandler,
  read: notImplemented('plugin/read') as MethodHandler,
  install: notImplemented('plugin/install') as MethodHandler,
  uninstall: notImplemented('plugin/uninstall') as MethodHandler,
};

// ── Review ─────────────────────────────────────────────────────────────────

export const reviewStart = notImplemented('review/start') as MethodHandler;

// ── Collaboration ──────────────────────────────────────────────────────────

export const collaborationModeList = (async () => ({ data: [] })) as MethodHandler;

// ── MCP Server ────────────────────────────────────────────────────────────

export const mcpServer = {
  oauthLogin: notImplemented('mcpServer/oauth/login') as MethodHandler,
};

export const mcpServerStatusList = (async () => ({ data: [] })) as MethodHandler;

export const mcpServerResource = {
  read: notImplemented('mcpServer/resource/read') as MethodHandler,
};

export const mcpServerTool = {
  call: notImplemented('mcpServer/tool/call') as MethodHandler,
};

// ── Config ─────────────────────────────────────────────────────────────────

export const configStubs = {
  valueWrite: notImplemented('config/value/write') as MethodHandler,
  batchWrite: notImplemented('config/batchWrite') as MethodHandler,
  requirementsRead: (async () => ({ requirements: [] })) as MethodHandler,
};

// ── Feedback ───────────────────────────────────────────────────────────────

export const feedbackUpload = notImplemented('feedback/upload') as MethodHandler;

// ── External Agent Config ──────────────────────────────────────────────────

export const externalAgentConfig = {
  detect: notImplemented('externalAgentConfig/detect') as MethodHandler,
  import_: notImplemented('externalAgentConfig/import') as MethodHandler,
};

// ── Tool ───────────────────────────────────────────────────────────────────

export const toolRequestUserInput = notImplemented('tool/requestUserInput') as MethodHandler;

// ── App ────────────────────────────────────────────────────────────────────

export const appList = (async () => ({ data: [] })) as MethodHandler;

// ── Remote Control ─────────────────────────────────────────────────────────

export const remoteControlStatusChanged = notImplemented('remoteControl/status/changed') as MethodHandler;

// ── Windows Sandbox ────────────────────────────────────────────────────────

export const windowsSandboxSetupStart = notImplemented('windowsSandbox/setupStart') as MethodHandler;

// ── Environment ────────────────────────────────────────────────────────────

export const environmentAdd = notImplemented('environment/add') as MethodHandler;

// ── Memory ─────────────────────────────────────────────────────────────────

export const memoryReset = notImplemented('memory/reset') as MethodHandler;

// ── Thread pagination ──────────────────────────────────────────────────────

export const threadTurns = {
  list: notImplemented('thread/turns/list') as MethodHandler,
  itemsList: notImplemented('thread/turns/items/list') as MethodHandler,
};
