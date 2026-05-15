import { account } from './account.js';
import { command } from './command.js';
import { config } from './config.js';
import { fs as fsHandlers } from './fs.js';
import { initialize } from './initialize.js';
import { models } from './models.js';
import { skills } from './skills.js';
import {
  appList,
  collaborationModeList,
  configStubs,
  environmentAdd,
  experimentalFeature,
  externalAgentConfig,
  feedbackUpload,
  fsWatch,
  hooksList,
  marketplace,
  mcpServer,
  mcpServerResource,
  mcpServerStatusList,
  mcpServerTool,
  memoryReset,
  modelProvider,
  plugin,
  processStubs,
  remoteControlStatusChanged,
  reviewStart,
  threadBackgroundTerminals,
  threadMemoryMode,
  threadRealtime,
  threadTurns,
  toolRequestUserInput,
  windowsSandboxSetupStart,
} from './stubs.js';
import { thread } from './thread.js';
import { turn } from './turn.js';

/**
 * All registered JSON-RPC method handlers.
 */
export const REGISTERED_HANDLERS: Record<string, import('../codexJsonRpcServer.js').MethodHandler> = {
  // Lifecycle
  initialize: initialize.handler,

  // Thread — core
  'thread/start': thread.start,
  'thread/resume': thread.resume,
  'thread/fork': thread.fork,
  'thread/list': thread.list,
  'thread/loaded/list': thread.loadedList,
  'thread/read': thread.read,
  'thread/archive': thread.archive,
  'thread/unarchive': thread.unarchive,

  // Thread — metadata & naming
  'thread/name/set': thread.nameSet,
  'thread/metadata/update': thread.metadataUpdate,

  // Thread — lifecycle
  'thread/compact/start': thread.compactStart,
  'thread/rollback': thread.rollback,
  'thread/inject_items': thread.injectItems,
  'thread/unsubscribe': thread.unsubscribe,
  'thread/shellCommand': thread.shellCommand,

  // Thread — goals
  'thread/goal/set': thread.goalSet,
  'thread/goal/get': thread.goalGet,
  'thread/goal/clear': thread.goalClear,

  // Thread — pagination (stub)
  'thread/turns/list': threadTurns.list,
  'thread/turns/items/list': threadTurns.itemsList,

  // Thread — experimental (stubs)
  'thread/realtime/start': threadRealtime.start,
  'thread/realtime/stop': threadRealtime.stop,
  'thread/realtime/appendAudio': threadRealtime.appendAudio,
  'thread/realtime/appendText': threadRealtime.appendText,
  'thread/backgroundTerminals/clean': threadBackgroundTerminals.clean,
  'thread/memoryMode/set': threadMemoryMode.set,

  // Turn
  'turn/start': turn.start,
  'turn/steer': turn.steer,
  'turn/interrupt': turn.interrupt,

  // Models
  'model/list': models.list,
  'modelProvider/capabilities/read': modelProvider.capabilitiesRead,

  // Account
  'account/read': account.read,

  // File system
  fuzzyFileSearch: fsHandlers.fuzzyFileSearch,
  'fs/fuzzyFileSearch': fsHandlers.fuzzyFileSearch,
  'fs/search': fsHandlers.fuzzyFileSearch,
  'fs/readFile': fsHandlers.readFile,
  'fs/writeFile': fsHandlers.writeFile,
  'fs/createDirectory': fsHandlers.createDirectory,
  'fs/getMetadata': fsHandlers.getMetadata,
  'fs/readDirectory': fsHandlers.readDirectory,
  'fs/remove': fsHandlers.remove,
  'fs/copy': fsHandlers.copy,
  'fs/watch': fsWatch.watch,
  'fs/unwatch': fsWatch.unwatch,

  // Shell
  'command/exec': command.exec,
  'command/exec/write': command.write,
  'command/exec/resize': command.resize,
  'command/exec/terminate': command.terminate,

  // Process (experimental, stubs)
  'process/spawn': processStubs.spawn,
  'process/writeStdin': processStubs.writeStdin,
  'process/resizePty': processStubs.resizePty,
  'process/kill': processStubs.kill,

  // Config
  'config/read': config.read,
  'config/value/write': configStubs.valueWrite,
  'config/batchWrite': configStubs.batchWrite,
  'configRequirements/read': configStubs.requirementsRead,

  // Skills
  'skills/list': skills.list,

  // Experimental features
  'experimentalFeature/list': experimentalFeature.list,
  'experimentalFeature/enablement/set': experimentalFeature.enablementSet,

  // Hooks
  'hooks/list': hooksList,

  // Marketplace
  'marketplace/add': marketplace.add,
  'marketplace/remove': marketplace.remove,
  'marketplace/upgrade': marketplace.upgrade,

  // Plugins
  'plugin/list': plugin.list,
  'plugin/read': plugin.read,
  'plugin/install': plugin.install,
  'plugin/uninstall': plugin.uninstall,

  // Review
  'review/start': reviewStart,

  // Collaboration
  'collaborationMode/list': collaborationModeList,

  // MCP
  'mcpServer/oauth/login': mcpServer.oauthLogin,
  'mcpServerStatus/list': mcpServerStatusList,
  'mcpServer/resource/read': mcpServerResource.read,
  'mcpServer/tool/call': mcpServerTool.call,

  // Feedback
  'feedback/upload': feedbackUpload,

  // External Agent Config
  'externalAgentConfig/detect': externalAgentConfig.detect,
  'externalAgentConfig/import': externalAgentConfig.import_,

  // Tool
  'tool/requestUserInput': toolRequestUserInput,

  // App
  'app/list': appList,

  // Remote Control
  'remoteControl/status/changed': remoteControlStatusChanged,

  // Windows Sandbox
  'windowsSandbox/setupStart': windowsSandboxSetupStart,

  // Environment
  'environment/add': environmentAdd,

  // Memory
  'memory/reset': memoryReset,
};
