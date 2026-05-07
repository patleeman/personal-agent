import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type AboutPanelOptionsOptions, app } from 'electron';

export interface DesktopAboutVersions {
  applicationVersion: string;
  piVersion: string;
}

function readVersionFromPackageJson(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as { version?: unknown };
      if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
        return parsed.version.trim();
      }
    } catch {
      // Ignore malformed or unreadable package metadata and try the next candidate.
    }
  }

  return null;
}

export function resolveDesktopAboutVersionsForPaths(currentDir: string, cwd = process.cwd()): DesktopAboutVersions {
  const packageDir = resolve(currentDir, '..');
  const applicationVersion = readVersionFromPackageJson([resolve(packageDir, 'package.json')]) ?? 'Unknown';
  const piVersion =
    readVersionFromPackageJson([
      resolve(packageDir, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json'),
      resolve(packageDir, '..', '..', 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json'),
      resolve(cwd, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json'),
    ]) ?? 'Unknown';

  return {
    applicationVersion,
    piVersion,
  };
}

export function buildDesktopAboutPanelOptions(input: {
  applicationName: string;
  applicationVersion: string;
  piVersion: string;
}): AboutPanelOptionsOptions {
  return {
    applicationName: input.applicationName,
    applicationVersion: input.applicationVersion,
    credits: `Pi ${input.piVersion}`,
  };
}

export function applyDesktopAboutPanelOptions(currentDir = dirname(fileURLToPath(import.meta.url))): void {
  const versions = resolveDesktopAboutVersionsForPaths(currentDir);

  app.setAboutPanelOptions(
    buildDesktopAboutPanelOptions({
      applicationName: app.name || 'Personal Agent',
      applicationVersion: versions.applicationVersion === 'Unknown' ? app.getVersion() : versions.applicationVersion,
      piVersion: versions.piVersion,
    }),
  );
}
