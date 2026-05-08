export const systemExtensionModules = new Map<string, () => Promise<Record<string, unknown>>>([
  ['system-automations', () => import('./systemAutomations/SystemAutomationsExtension')],
  ['system-gateways', () => import('../pages/GatewaysPage')],
  ['system-knowledge', () => import('../../../../../extensions/system-knowledge/src/frontend')],
  ['system-telemetry', () => import('../pages/TracesPage').then((module) => ({ TelemetryPage: module.TracesPage }))],
  ['system-files', () => import('../../../../../extensions/system-files/src/frontend')],
  ['system-artifacts', () => import('./systemWorkbench/SystemArtifactsExtension')],
  ['system-browser', () => import('../../../../../extensions/system-browser/src/frontend')],
  ['system-diffs', () => import('./systemWorkbench/SystemDiffsExtension')],
  ['system-runs', () => import('./systemWorkbench/SystemRunsExtension')],
  ['system-settings', () => import('../../../../../extensions/system-settings/src/frontend')],
]);
