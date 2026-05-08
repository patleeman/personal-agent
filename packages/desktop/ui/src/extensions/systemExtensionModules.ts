export const systemExtensionModules = new Map<string, () => Promise<Record<string, unknown>>>([
  ['system-automations', () => import('./systemAutomations/SystemAutomationsExtension')],
  ['system-gateways', () => import('../../../../../extensions/system-gateways/src/frontend')],
  ['system-knowledge', () => import('../../../../../extensions/system-knowledge/src/frontend')],
  ['system-telemetry', () => import('../../../../../extensions/system-telemetry/src/frontend')],
  ['system-files', () => import('../../../../../extensions/system-files/src/frontend')],
  ['system-artifacts', () => import('../../../../../extensions/system-artifacts/src/frontend')],
  ['system-browser', () => import('../../../../../extensions/system-browser/src/frontend')],
  ['system-diffs', () => import('../../../../../extensions/system-diffs/src/frontend')],
  ['system-runs', () => import('../../../../../extensions/system-runs/src/frontend')],
  ['system-settings', () => import('../../../../../extensions/system-settings/src/frontend')],
]);
