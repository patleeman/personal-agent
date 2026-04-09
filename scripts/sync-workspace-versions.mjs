import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const rootPackagePath = join(repoRoot, 'package.json');
const rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf-8'));

if (typeof rootPackage.version !== 'string' || rootPackage.version.trim().length === 0) {
  throw new Error('Root package.json is missing a version string.');
}

const version = rootPackage.version;
const packagesDir = join(repoRoot, 'packages');
const packageNames = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const packageName of packageNames) {
  const packagePath = join(packagesDir, packageName, 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
  if (packageJson.version === version) {
    continue;
  }

  packageJson.version = version;
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}
