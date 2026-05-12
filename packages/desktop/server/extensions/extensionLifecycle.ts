import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getStateRoot } from '@personal-agent/core';
import type { Plugin } from 'esbuild';

import { isPrebuiltOnlyExtensionRuntime } from './extensionBackendLoadTarget.js';
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
  template?: unknown;
}

type RuntimeExtensionTemplate = 'main-page' | 'right-rail' | 'workbench-detail';

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

function normalizeExtensionTemplate(value: unknown): RuntimeExtensionTemplate {
  if (value === undefined || value === null || value === '') return 'main-page';
  if (value === 'main-page' || value === 'right-rail' || value === 'workbench-detail') return value;
  throw new Error('Extension template must be main-page, right-rail, or workbench-detail.');
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

function assertRuntimeExtensionBuildSupported(): void {
  if (!isPrebuiltOnlyExtensionRuntime()) {
    return;
  }

  throw new Error(
    'Packaged desktop builds do not compile extensions at runtime. Prebuild dist/frontend.js and dist/backend.mjs before importing or enabling the extension.',
  );
}

function starterHelpText(): string {
  return 'Edit <code>src/frontend.tsx</code>, run <code>npm run extension:build -- &lt;extension-dir&gt;</code> from the personal-agent repo, then reload extensions.';
}

function createStarterFrontend(name: string, template: RuntimeExtensionTemplate): string {
  if (template === 'right-rail') {
    return `import type { ExtensionSurfaceProps } from '@personal-agent/extensions';

export function ExtensionPanel({ pa }: ExtensionSurfaceProps) {
  return (
    <aside className="h-full overflow-auto px-4 py-5 text-[13px] text-secondary">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Right rail</p>
      <h2 className="mt-2 text-lg font-semibold text-primary">${name}</h2>
      <p className="mt-2 leading-6">${starterHelpText()}</p>
      <button className="ui-toolbar-button mt-4" type="button" onClick={() => pa.ui.toast('${name} is wired up.')}>
        Test toast
      </button>
    </aside>
  );
}
`;
  }

  if (template === 'workbench-detail') {
    return `import type { ExtensionSurfaceProps } from '@personal-agent/extensions';

export function ExtensionRail({ pa }: ExtensionSurfaceProps) {
  return (
    <aside className="h-full overflow-auto px-4 py-5 text-[13px] text-secondary">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Right rail</p>
      <h2 className="mt-2 text-lg font-semibold text-primary">${name}</h2>
      <p className="mt-2 leading-6">Select something here; render the large view in the paired workbench detail surface.</p>
      <button className="ui-toolbar-button mt-4" type="button" onClick={() => pa.ui.toast('${name} rail action')}>
        Test toast
      </button>
    </aside>
  );
}

export function ExtensionWorkbench({ pa }: ExtensionSurfaceProps) {
  return (
    <main className="flex h-full items-center justify-center px-8 text-center">
      <div className="max-w-md">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Workbench detail</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-primary">${name}</h1>
        <p className="mt-2 text-[13px] leading-6 text-secondary">${starterHelpText()}</p>
        <button className="ui-toolbar-button mt-6" type="button" onClick={() => pa.ui.toast('${name} detail action')}>
          Test toast
        </button>
      </div>
    </main>
  );
}
`;
  }

  return `import type { ExtensionSurfaceProps } from '@personal-agent/extensions';

export function ExtensionPage({ pa }: ExtensionSurfaceProps) {
  return (
    <main className="mx-auto max-w-5xl px-8 py-14">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Extension</p>
      <h1 className="mt-2 text-[34px] font-semibold tracking-[-0.04em] text-primary">${name}</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-6 text-secondary">${starterHelpText()}</p>
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
  const template = normalizeExtensionTemplate(input.template);
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
    contributes:
      template === 'right-rail'
        ? {
            views: [{ id: 'panel', title: name, location: 'rightRail', scope: 'conversation', component: 'ExtensionPanel', icon: 'app' }],
          }
        : template === 'workbench-detail'
          ? {
              views: [
                {
                  id: 'rail',
                  title: name,
                  location: 'rightRail',
                  scope: 'conversation',
                  component: 'ExtensionRail',
                  icon: 'app',
                  detailView: 'detail',
                },
                { id: 'detail', title: `${name} detail`, location: 'workbench', component: 'ExtensionWorkbench' },
              ],
            }
          : {
              views: [{ id: 'page', title: name, location: 'main', route: `/ext/${id}`, component: 'ExtensionPage' }],
              nav: [{ id: 'nav', label: name, route: `/ext/${id}`, icon: 'app' }],
            },
    permissions: [],
  });
  writeFileSync(join(extensionRoot, 'extension.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(extensionRoot, 'src', 'frontend.tsx'), createStarterFrontend(name, template));
  writeFileSync(join(extensionRoot, 'src', 'backend.ts'), createStarterBackend());
  writeFileSync(
    join(extensionRoot, 'package.json'),
    `${JSON.stringify({ type: 'module', dependencies: { '@personal-agent/extensions': '*' } }, null, 2)}\n`,
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
    throw new Error('Extension package root is unavailable.');
  }

  const timestamp = createSafeTimestamp();
  const snapshotRoot = join(getExtensionSnapshotsRoot(stateRoot), extensionId);
  const snapshotPath = join(snapshotRoot, timestamp);
  mkdirSync(snapshotRoot, { recursive: true });
  cpSync(entry.packageRoot, snapshotPath, { recursive: true, errorOnExist: true });

  return { ok: true as const, extensionId, snapshotPath };
}

export async function buildRuntimeExtension(extensionId: string) {
  const entry = findExtensionEntry(extensionId);
  if (!entry) {
    throw new Error('Extension not found.');
  }
  if (!entry.packageRoot) {
    throw new Error('Extension package root is unavailable.');
  }
  if (entry.manifest.schemaVersion !== 2) {
    throw new Error('Only native extension manifest schemaVersion 2 can be built.');
  }

  assertRuntimeExtensionBuildSupported();

  const packageRoot = resolve(entry.packageRoot);
  const { build } = await import('esbuild');
  const outputs: string[] = [];
  const frontendSource = join(packageRoot, 'src', 'frontend.tsx');
  if (entry.manifest.frontend?.entry && existsSync(frontendSource)) {
    const outfile = resolve(packageRoot, entry.manifest.frontend.entry);
    assertInside(packageRoot, outfile);
    mkdirSync(dirname(outfile), { recursive: true });
    await build({
      entryPoints: [frontendSource],
      outfile,
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      jsx: 'automatic',
      sourcemap: true,
      plugins: [createFrontendExtensionSdkPlugin()],
      nodePaths: findAppNodeModules(),
    });
    outputs.push(outfile);
  }

  const backendSource = join(packageRoot, 'src', 'backend.ts');
  if (entry.manifest.backend?.entry && existsSync(backendSource)) {
    const outfile = resolve(packageRoot, entry.manifest.backend.entry);
    assertInside(packageRoot, outfile);
    mkdirSync(dirname(outfile), { recursive: true });
    await build({
      entryPoints: [backendSource],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      sourcemap: true,
      external: ['@personal-agent/*', 'electron'],
      nodePaths: findAppNodeModules(),
    });
    outputs.push(outfile);
  }

  return { ok: true as const, extensionId, outputs };
}

export function exportRuntimeExtension(extensionId: string, stateRoot: string = getStateRoot()) {
  const entry = findExtensionEntry(extensionId);
  if (!entry) {
    throw new Error('Extension not found.');
  }
  if (!entry.packageRoot) {
    throw new Error('Extension package root is unavailable.');
  }

  const exportsRoot = getExtensionExportsRoot(stateRoot);
  mkdirSync(exportsRoot, { recursive: true });
  const exportPath = join(exportsRoot, `${extensionId}-${createSafeTimestamp()}.zip`);
  const packageRoot = resolve(entry.packageRoot);
  const parent = resolve(packageRoot, '..');
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

function findAppNodeModules(): string[] {
  const paths: string[] = [resolve(process.cwd(), 'node_modules')];
  if (typeof process.resourcesPath === 'string') {
    paths.push(resolve(process.resourcesPath, 'app.asar.unpacked/node_modules'));
  }
  const currentDir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 2; depth <= 5; depth++) {
    paths.push(resolve(currentDir, ...Array(depth).fill('..'), 'node_modules'));
  }
  return paths;
}

function resolveDesktopUiExtensionModule(moduleName: string): string | null {
  const moduleFiles: Record<string, string> = {
    '@personal-agent/extensions/host': 'host.ts',
    '@personal-agent/extensions/ui': 'ui.ts',
    '@personal-agent/extensions/workbench': 'workbench.ts',
    '@personal-agent/extensions/data': 'data.ts',
    '@personal-agent/extensions/settings': 'settings.ts',
  };
  const moduleFile = moduleFiles[moduleName];
  if (!moduleFile) {
    return null;
  }

  const repoRoot = process.env.PERSONAL_AGENT_REPO_ROOT?.trim();
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    ...(repoRoot ? [resolve(repoRoot, 'packages', 'desktop', 'ui', 'src', 'extensions', moduleFile)] : []),
    resolve(currentDir, '..', '..', 'ui', 'src', 'extensions', moduleFile),
    resolve(currentDir, '..', '..', '..', 'ui', 'src', 'extensions', moduleFile),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function createFrontendExtensionSdkPlugin(): Plugin {
  return {
    name: 'personal-agent-frontend-extension-sdk',
    setup(build) {
      build.onResolve({ filter: /^@personal-agent\/extensions\/(host|ui|workbench|data|settings)$/ }, (args) => {
        const resolved = resolveDesktopUiExtensionModule(args.path);
        if (!resolved) {
          return { errors: [{ text: `Could not resolve ${args.path} for frontend extension build.` }] };
        }
        return { path: resolved };
      });
    },
  };
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
