import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type ExtensionManifest } from './extensionManifest.js';
import { listExtensionPackagePaths } from './extensionPackagePaths.js';

export interface SystemExtensionEntry {
  manifest: ExtensionManifest;
  packageRoot: string;
}

export function readBundledExtensionEntries(): SystemExtensionEntry[] {
  return listExtensionPackagePaths()
    .filter((entry) => entry.source === 'bundled')
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

export const SYSTEM_EXTENSION_ENTRIES: SystemExtensionEntry[] = readBundledExtensionEntries();
export const SYSTEM_EXTENSIONS: ExtensionManifest[] = SYSTEM_EXTENSION_ENTRIES.map((entry) => entry.manifest);
