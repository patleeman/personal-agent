import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getStateRoot } from '@personal-agent/core';

import {
  findExtensionEntry,
  getRuntimeExtensionsRoot,
  listExtensionInstallSummaries,
  parseExtensionManifest,
} from './extensionRegistry.js';

export interface CreateRuntimeExtensionInput {
  id?: unknown;
  name?: unknown;
  description?: unknown;
}

function normalizeExtensionId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Extension id is required.');
  }

  const id = value.trim();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(id)) {
    throw new Error('Extension id must be 2-63 lowercase letters, numbers, or dashes, starting with a letter or number.');
  }

  return id;
}

function normalizeExtensionName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Extension name is required.');
  }

  return value.trim();
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getExtensionSnapshotsRoot(stateRoot: string = getStateRoot()): string {
  return join(stateRoot, 'extension-snapshots');
}

function createStarterHtml(name: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${name}</title>
  </head>
  <body>
    <main class="pa-page pa-stack">
      <section class="pa-card">
        <p class="pa-eyebrow">Extension</p>
        <h1>${name}</h1>
        <p>Edit this runtime extension from its folder. The PA client API is available as <code>window.PA</code>.</p>
      </section>
    </main>
  </body>
</html>
`;
}

export function createRuntimeExtension(input: CreateRuntimeExtensionInput, stateRoot: string = getStateRoot()) {
  const id = normalizeExtensionId(input.id);
  const name = normalizeExtensionName(input.name);
  const description = normalizeOptionalString(input.description);
  if (findExtensionEntry(id)) {
    throw new Error('Extension id already exists.');
  }

  const extensionRoot = join(getRuntimeExtensionsRoot(stateRoot), id);
  if (existsSync(extensionRoot)) {
    throw new Error('Extension directory already exists.');
  }

  mkdirSync(join(extensionRoot, 'frontend'), { recursive: true });
  const manifest = parseExtensionManifest({
    schemaVersion: 1,
    id,
    name,
    packageType: 'user',
    ...(description ? { description } : {}),
    surfaces: [
      {
        id: 'page',
        placement: 'main',
        kind: 'page',
        route: `/ext/${id}`,
        entry: 'frontend/index.html',
      },
    ],
    permissions: [],
  });
  writeFileSync(join(extensionRoot, 'extension.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(extensionRoot, 'frontend', 'index.html'), createStarterHtml(name));

  const summary = listExtensionInstallSummaries(stateRoot).find((extension) => extension.id === id);
  return { ok: true as const, extension: summary, packageRoot: extensionRoot };
}

export function snapshotRuntimeExtension(extensionId: string, stateRoot: string = getStateRoot()) {
  const entry = findExtensionEntry(extensionId);
  if (!entry) {
    throw new Error('Extension not found.');
  }
  if (!entry.packageRoot) {
    throw new Error('Only runtime extensions can be snapshotted.');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotRoot = join(getExtensionSnapshotsRoot(stateRoot), extensionId);
  const snapshotPath = join(snapshotRoot, timestamp);
  mkdirSync(snapshotRoot, { recursive: true });
  cpSync(entry.packageRoot, snapshotPath, { recursive: true, errorOnExist: true });

  return { ok: true as const, extensionId, snapshotPath };
}
