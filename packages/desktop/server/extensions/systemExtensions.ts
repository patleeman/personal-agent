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

export const SYSTEM_EXTENSION_ENTRIES: SystemExtensionEntry[] = [
  readBundledSystemExtension('system-automations', FALLBACK_SYSTEM_AUTOMATIONS_MANIFEST),
];

export const SYSTEM_EXTENSIONS: ExtensionManifest[] = SYSTEM_EXTENSION_ENTRIES.map((entry) => entry.manifest);
