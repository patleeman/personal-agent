import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ExtensionManifest } from './extensionManifest.js';

export interface SystemExtensionEntry {
  manifest: ExtensionManifest;
  packageRoot?: string;
}

const FALLBACK_SYSTEM_AUTOMATIONS_MANIFEST: ExtensionManifest = {
  schemaVersion: 2,
  id: 'system-automations',
  name: 'Automations',
  packageType: 'system',
  description: 'Manage scheduled and conversation-bound automations.',
  version: '0.2.0',
  frontend: { entry: 'dist/frontend.js', styles: [] },
  contributes: {
    views: [{ id: 'page', title: 'Automations', location: 'main', route: '/automations', component: 'AutomationsPage' }],
  },
  permissions: ['runs:read', 'runs:start', 'conversations:readwrite', 'ui:notify'],
};

function candidateSystemExtensionRoots(): string[] {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return [
    process.env.PERSONAL_AGENT_REPO_ROOT ? resolve(process.env.PERSONAL_AGENT_REPO_ROOT, 'extensions') : null,
    typeof process.resourcesPath === 'string' ? resolve(process.resourcesPath, 'extensions') : null,
    resolve(process.cwd(), 'extensions'),
    resolve(currentDir, '../../../../extensions'),
    resolve(currentDir, '../../../../../extensions'),
  ].filter((value): value is string => Boolean(value));
}

function readBundledSystemExtension(id: string, fallback: ExtensionManifest): SystemExtensionEntry {
  for (const root of candidateSystemExtensionRoots()) {
    const packageRoot = join(root, id);
    const manifestPath = join(packageRoot, 'extension.json');
    if (!existsSync(manifestPath)) {
      continue;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ExtensionManifest;
    return { manifest: { ...manifest, packageType: 'system' }, packageRoot };
  }

  return { manifest: fallback };
}

const FALLBACK_SYSTEM_GATEWAYS_MANIFEST: ExtensionManifest = {
  schemaVersion: 2,
  id: 'system-gateways',
  name: 'Gateways',
  packageType: 'system',
  description: 'Manage external provider gateway bindings and connection state.',
  version: '0.1.0',
  frontend: { entry: 'dist/frontend.js', styles: [] },
  contributes: {
    views: [{ id: 'page', title: 'Gateways', location: 'main', route: '/gateways', component: 'GatewaysPage' }],
    nav: [{ id: 'nav', label: 'Gateways', route: '/gateways', icon: 'database' }],
  },
  permissions: ['gateways:read', 'gateways:write'],
};

const FALLBACK_SYSTEM_TELEMETRY_MANIFEST: ExtensionManifest = {
  schemaVersion: 2,
  id: 'system-telemetry',
  name: 'Telemetry',
  packageType: 'system',
  description: 'Inspect app traces, model usage, tool health, and runtime performance.',
  version: '0.1.0',
  frontend: { entry: 'dist/frontend.js', styles: [] },
  contributes: {
    views: [{ id: 'page', title: 'Telemetry', location: 'main', route: '/telemetry', component: 'TelemetryPage' }],
    nav: [{ id: 'nav', label: 'Telemetry', route: '/telemetry', icon: 'graph' }],
  },
  permissions: ['telemetry:read'],
};

const FALLBACK_SYSTEM_RUNS_MANIFEST: ExtensionManifest = {
  schemaVersion: 2,
  id: 'system-runs',
  name: 'Runs',
  packageType: 'system',
  description: 'Inspect and manage background work linked to the active conversation.',
  version: '0.1.0',
  frontend: { entry: 'dist/frontend.js', styles: [] },
  contributes: {
    views: [
      {
        id: 'conversation-runs',
        title: 'Runs',
        location: 'rightRail',
        scope: 'conversation',
        component: 'ConversationRunsPanel',
        icon: 'terminal',
      },
    ],
  },
  permissions: ['runs:read', 'runs:write'],
};

const FALLBACK_SYSTEM_DIFFS_MANIFEST: ExtensionManifest = {
  schemaVersion: 2,
  id: 'system-diffs',
  name: 'Diffs',
  packageType: 'system',
  description: 'Review uncommitted workspace changes and checkpoint diffs for the active conversation.',
  version: '0.1.0',
  frontend: { entry: 'dist/frontend.js', styles: [] },
  contributes: {
    views: [
      {
        id: 'conversation-diffs',
        title: 'Diffs',
        location: 'rightRail',
        scope: 'conversation',
        component: 'ConversationDiffsPanel',
        icon: 'diff',
      },
    ],
  },
  permissions: ['workspace:read', 'conversations:read'],
};

export const SYSTEM_EXTENSION_ENTRIES: SystemExtensionEntry[] = [
  readBundledSystemExtension('system-automations', FALLBACK_SYSTEM_AUTOMATIONS_MANIFEST),
  readBundledSystemExtension('system-gateways', FALLBACK_SYSTEM_GATEWAYS_MANIFEST),
  readBundledSystemExtension('system-telemetry', FALLBACK_SYSTEM_TELEMETRY_MANIFEST),
  readBundledSystemExtension('system-runs', FALLBACK_SYSTEM_RUNS_MANIFEST),
  readBundledSystemExtension('system-diffs', FALLBACK_SYSTEM_DIFFS_MANIFEST),
];

export const SYSTEM_EXTENSIONS: ExtensionManifest[] = SYSTEM_EXTENSION_ENTRIES.map((entry) => entry.manifest);
