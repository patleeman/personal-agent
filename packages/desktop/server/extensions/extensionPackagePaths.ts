import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ExtensionPackagePath {
  packageRoot: string;
  source: 'bundled' | 'external';
}

function splitPathList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,:]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function candidateBundledExtensionRoots(): string[] {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return [
    process.env.PERSONAL_AGENT_REPO_ROOT ? resolve(process.env.PERSONAL_AGENT_REPO_ROOT, 'extensions') : null,
    typeof process.resourcesPath === 'string' ? resolve(process.resourcesPath, 'extensions') : null,
    resolve(process.cwd(), 'extensions'),
    resolve(currentDir, '../../../../extensions'),
    resolve(currentDir, '../../../../../extensions'),
  ].filter((value): value is string => Boolean(value));
}

function expandExtensionPath(rootOrPackage: string, source: ExtensionPackagePath['source']): ExtensionPackagePath[] {
  const root = resolve(rootOrPackage);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return [];
  }

  if (existsSync(resolve(root, 'extension.json'))) {
    return [{ packageRoot: root, source }];
  }

  return readdirSync(root)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((entryName): ExtensionPackagePath[] => {
      const packageRoot = resolve(root, entryName);
      if (!statSync(packageRoot).isDirectory() || !existsSync(resolve(packageRoot, 'extension.json'))) {
        return [];
      }
      return [{ packageRoot, source }];
    });
}

export function listExtensionPackagePaths(options: { runtimeRoot?: string } = {}): ExtensionPackagePath[] {
  const seen = new Set<string>();
  const inputs: Array<{ path: string; source: ExtensionPackagePath['source'] }> = [
    ...candidateBundledExtensionRoots().map((path) => ({ path, source: 'bundled' as const })),
    ...(options.runtimeRoot ? [{ path: options.runtimeRoot, source: 'external' as const }] : []),
    ...splitPathList(process.env.PERSONAL_AGENT_EXTENSION_PATHS).map((path) => ({ path, source: 'external' as const })),
  ];

  return inputs
    .flatMap(({ path, source }) => expandExtensionPath(path, source))
    .filter((entry) => {
      const key = entry.packageRoot;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
