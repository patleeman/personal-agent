export const DEFAULT_BACKEND_BUNDLE_BYTE_LIMIT = 8 * 1024 * 1024;

export const BACKEND_BUNDLE_BYTE_LIMITS = new Map([
  ['system-automations', 1 * 1024 * 1024],
  ['system-conversation-tools', 1 * 1024 * 1024],
  ['system-extension-manager', 1 * 1024 * 1024],
  ['system-image-probe', 2 * 1024 * 1024],
  ['system-images', 2 * 1024 * 1024],
  ['system-knowledge', 1 * 1024 * 1024],
  ['system-openai-native-compaction', 1 * 1024 * 1024],
  ['system-runs', 1 * 1024 * 1024],
  ['system-suggested-context', 1 * 1024 * 1024],
  ['system-web-tools', 8 * 1024 * 1024],
  ['slack-mcp-gateway', 2 * 1024 * 1024],
  ['system-session-exchange', 1 * 1024 * 1024],
]);

export const FORBIDDEN_BUNDLED_PATH_FRAGMENTS = ['/node_modules/@personal-agent/daemon/', '/packages/daemon/'];

export const PRODUCT_CRITICAL_EXTENSION_SMOKE_ACTIONS = new Map([
  ['system-automations', { scheduledTask: { action: 'list' }, conversationQueue: { action: 'list' } }],
  ['system-diffs', { checkpoint: { action: 'list' } }],
  ['system-knowledge', { readState: {}, vaultTree: {}, vaultSearch: { q: '', limit: 1 } }],
]);

export function backendBundleByteLimit(extensionId) {
  return BACKEND_BUNDLE_BYTE_LIMITS.get(extensionId) ?? DEFAULT_BACKEND_BUNDLE_BYTE_LIMIT;
}

export function criticalSmokeActionInput(extensionId, actionId) {
  return PRODUCT_CRITICAL_EXTENSION_SMOKE_ACTIONS.get(extensionId)?.[actionId];
}
