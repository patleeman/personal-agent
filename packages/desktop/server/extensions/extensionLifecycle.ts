import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

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

function getExtensionExportsRoot(stateRoot: string = getStateRoot()): string {
  return join(stateRoot, 'extension-exports');
}

function assertInside(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Path escapes extension root.');
  }
}

function createSafeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function createStarterFrontend(name: string): string {
  return `import type { ExtensionSurfaceProps } from '@personal-agent/extensions';

export function ExtensionPage({ pa }: ExtensionSurfaceProps) {
  return (
    <main className="mx-auto max-w-5xl px-8 py-14">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Extension</p>
      <h1 className="mt-2 text-[34px] font-semibold tracking-[-0.04em] text-primary">${name}</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-6 text-secondary">
        Edit <code>src/frontend.tsx</code>, run <code>pa extension build</code>, then reload extensions.
      </p>
      <button className="ui-toolbar-button mt-6" type="button" onClick={() => pa.ui.toast('${name} is wired up.')}>
        Test toast
      </button>
    </main>
  );
}
`;
}

function createStarterBackend(): string {
  return `import type { ExtensionBackendContext } from '@personal-agent/extensions';

export async function ping(_input: unknown, ctx: ExtensionBackendContext) {
  ctx.log.info('ping');
  return { ok: true, at: new Date().toISOString() };
}
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

  mkdirSync(join(extensionRoot, 'src'), { recursive: true });
  mkdirSync(join(extensionRoot, 'dist'), { recursive: true });
  const manifest = parseExtensionManifest({
    schemaVersion: 2,
    id,
    name,
    packageType: 'user',
    ...(description ? { description } : {}),
    frontend: { entry: 'dist/frontend.js', styles: [] },
    backend: { entry: 'dist/backend.mjs', actions: [{ id: 'ping', handler: 'ping', title: 'Ping' }] },
    contributes: {
      views: [{ id: 'page', title: name, location: 'main', route: `/ext/${id}`, component: 'ExtensionPage' }],
      nav: [{ id: 'nav', label: name, route: `/ext/${id}`, icon: 'app' }],
    },
    permissions: [],
  });
  writeFileSync(join(extensionRoot, 'extension.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(extensionRoot, 'src', 'frontend.tsx'), createStarterFrontend(name));
  writeFileSync(join(extensionRoot, 'src', 'backend.ts'), createStarterBackend());
  writeFileSync(
    join(extensionRoot, 'package.json'),
    `${JSON.stringify({ type: 'module', scripts: { build: 'pa extension build' }, dependencies: { '@personal-agent/extensions': '*' } }, null, 2)}\n`,
  );

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

  const timestamp = createSafeTimestamp();
  const snapshotRoot = join(getExtensionSnapshotsRoot(stateRoot), extensionId);
  const snapshotPath = join(snapshotRoot, timestamp);
  mkdirSync(snapshotRoot, { recursive: true });
  cpSync(entry.packageRoot, snapshotPath, { recursive: true, errorOnExist: true });

  return { ok: true as const, extensionId, snapshotPath };
}

export function exportRuntimeExtension(extensionId: string, stateRoot: string = getStateRoot()) {
  const entry = findExtensionEntry(extensionId);
  if (!entry) {
    throw new Error('Extension not found.');
  }
  if (!entry.packageRoot) {
    throw new Error('Only runtime extensions can be exported.');
  }

  const exportsRoot = getExtensionExportsRoot(stateRoot);
  mkdirSync(exportsRoot, { recursive: true });
  const exportPath = join(exportsRoot, `${extensionId}-${createSafeTimestamp()}.zip`);
  const packageRoot = resolve(entry.packageRoot);
  const parent = resolve(packageRoot, '..');
  assertInside(getRuntimeExtensionsRoot(stateRoot), packageRoot);
  execFileSync('zip', ['-qry', exportPath, basename(packageRoot)], { cwd: parent });

  return { ok: true as const, extensionId, exportPath };
}

function readZipEntries(zipPath: string): string[] {
  const output = execFileSync('zipinfo', ['-1', zipPath], { encoding: 'utf-8' });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function assertSafeZipEntries(entries: string[]): void {
  if (entries.length === 0) {
    throw new Error('Extension bundle is empty.');
  }

  for (const entry of entries) {
    if (entry.startsWith('/') || entry.includes('..') || entry.includes('\\')) {
      throw new Error('Extension bundle contains unsafe paths.');
    }
  }
}

function findExtractedManifestRoot(extractRoot: string): string {
  const directManifest = join(extractRoot, 'extension.json');
  if (existsSync(directManifest)) {
    return extractRoot;
  }

  const candidates = readdirSync(extractRoot)
    .map((entry) => join(extractRoot, entry))
    .filter((entry) => statSync(entry).isDirectory() && existsSync(join(entry, 'extension.json')));
  if (candidates.length !== 1) {
    throw new Error('Extension bundle must contain exactly one extension.json.');
  }

  return candidates[0] as string;
}

export function importRuntimeExtensionBundle(input: { zipPath?: unknown }, stateRoot: string = getStateRoot()) {
  const zipPath = normalizeOptionalString(input.zipPath);
  if (!zipPath) {
    throw new Error('zipPath is required.');
  }
  if (!existsSync(zipPath) || !statSync(zipPath).isFile()) {
    throw new Error('Extension bundle not found.');
  }

  assertSafeZipEntries(readZipEntries(zipPath));
  const extractRoot = mkdtempSync(join(tmpdir(), 'pa-extension-import-'));
  try {
    execFileSync('unzip', ['-q', zipPath, '-d', extractRoot]);
    const packageRoot = findExtractedManifestRoot(extractRoot);
    assertInside(extractRoot, packageRoot);
    const manifest = parseExtensionManifest(JSON.parse(readFileSync(join(packageRoot, 'extension.json'), 'utf-8')));
    const id = normalizeExtensionId(manifest.id);
    const destination = join(getRuntimeExtensionsRoot(stateRoot), id);
    if (existsSync(destination) || findExtensionEntry(id)) {
      throw new Error('Extension id already exists.');
    }

    mkdirSync(getRuntimeExtensionsRoot(stateRoot), { recursive: true });
    cpSync(packageRoot, destination, { recursive: true, errorOnExist: true });
    const summary = listExtensionInstallSummaries(stateRoot).find((extension) => extension.id === id);
    return { ok: true as const, extension: summary, packageRoot: destination };
  } finally {
    rmSync(extractRoot, { recursive: true, force: true });
  }
}
