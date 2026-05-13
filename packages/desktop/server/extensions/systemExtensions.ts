import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type ExtensionManifest } from './extensionManifest.js';
import { listExtensionPackagePaths } from './extensionPackagePaths.js';

export interface SystemExtensionEntry {
  manifest: ExtensionManifest;
  packageRoot: string;
}

function readExtensionEntries(source: 'bundled' | 'experimental'): SystemExtensionEntry[] {
  return listExtensionPackagePaths()
    .filter((entry) => entry.source === source)
    .flatMap((entry): SystemExtensionEntry[] => {
      try {
        const manifest = JSON.parse(readFileSync(join(entry.packageRoot, 'extension.json'), 'utf-8')) as ExtensionManifest;
        if (!manifest.id || !manifest.name) return [];
        return [{ manifest: { ...manifest, packageType: manifest.packageType ?? 'system' }, packageRoot: entry.packageRoot }];
      } catch {
        return [];
      }
    });
}

export function readBundledExtensionEntries(): SystemExtensionEntry[] {
  return readExtensionEntries('bundled');
}

export function readExperimentalExtensionEntries(): SystemExtensionEntry[] {
  return readExtensionEntries('experimental');
}

export const SYSTEM_EXTENSION_ENTRIES: SystemExtensionEntry[] = readBundledExtensionEntries();
export const EXPERIMENTAL_EXTENSION_ENTRIES: SystemExtensionEntry[] = readExperimentalExtensionEntries();
export const SYSTEM_EXTENSIONS: ExtensionManifest[] = SYSTEM_EXTENSION_ENTRIES.map((entry) => entry.manifest);
