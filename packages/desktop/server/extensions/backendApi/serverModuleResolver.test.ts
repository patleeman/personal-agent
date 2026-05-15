import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { normalizeServerExtensionModuleSpecifier, resolveServerModuleSpecifierFrom } from './serverModuleResolver.js';

const previousRepoRoot = process.env.PERSONAL_AGENT_REPO_ROOT;
const previousCwd = process.cwd();
const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pa-server-module-resolver-'));
  tempRoots.push(root);
  return root;
}

function touch(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '');
}

afterEach(() => {
  if (previousRepoRoot === undefined) {
    delete process.env.PERSONAL_AGENT_REPO_ROOT;
  } else {
    process.env.PERSONAL_AGENT_REPO_ROOT = previousRepoRoot;
  }

  process.chdir(previousCwd);

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('resolveServerModuleSpecifierFrom', () => {
  it('resolves known backend package specifiers to packaged entries when present', () => {
    const resourcesRoot = makeTempRoot();
    const cwdRoot = makeTempRoot();
    const corePath = join(resourcesRoot, 'app.asar/server/dist/core/index.js');
    touch(corePath);
    delete process.env.PERSONAL_AGENT_REPO_ROOT;
    process.chdir(cwdRoot);

    expect(
      resolveServerModuleSpecifierFrom({
        importMetaUrl: import.meta.url,
        relativeSpecifier: '@personal-agent/core',
        resourcesPath: resourcesRoot,
      }),
    ).toBe(pathToFileURL(corePath).href);
  });

  it('returns unknown package specifiers unchanged', () => {
    expect(
      resolveServerModuleSpecifierFrom({
        importMetaUrl: import.meta.url,
        relativeSpecifier: 'left-pad',
      }),
    ).toBe('left-pad');
  });

  it('prefers bundled server/dist over tsc dist/server when both exist', () => {
    const repoRoot = makeTempRoot();
    const bundledPath = join(repoRoot, 'packages/desktop/server/dist/conversations/conversationInspectWorkerClient.js');
    const tscPath = join(repoRoot, 'packages/desktop/dist/server/conversations/conversationInspectWorkerClient.js');
    touch(bundledPath);
    touch(tscPath);
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;

    const resolved = resolveServerModuleSpecifierFrom({
      importMetaUrl: pathToFileURL(join(repoRoot, 'extension-cache/system-conversation-tools/backend.mjs')).href,
      relativeSpecifier: '../../conversations/conversationInspectWorkerClient.js',
    });

    expect(resolved).toBe(pathToFileURL(bundledPath).href);
  });

  it('uses the sibling module when no bundled, cwd, or tsc module exists', () => {
    const root = makeTempRoot();
    const backendPath = join(root, 'extension-cache/system-conversation-tools/backend.mjs');
    const siblingPath = join(root, 'unlikely-test-only-module/serverModuleResolverFallback.js');
    touch(backendPath);
    touch(siblingPath);
    delete process.env.PERSONAL_AGENT_REPO_ROOT;

    const resolved = resolveServerModuleSpecifierFrom({
      importMetaUrl: pathToFileURL(backendPath).href,
      relativeSpecifier: '../../unlikely-test-only-module/serverModuleResolverFallback.js',
    });

    expect(resolved).toBe(pathToFileURL(siblingPath).href);
  });

  it('supports extension server module normalization through the same precedence', () => {
    const repoRoot = makeTempRoot();
    const bundledPath = join(repoRoot, 'packages/desktop/server/dist/extensions/extensionLifecycle.js');
    const tscPath = join(repoRoot, 'packages/desktop/dist/server/extensions/extensionLifecycle.js');
    touch(bundledPath);
    touch(tscPath);
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;

    const resolved = resolveServerModuleSpecifierFrom({
      importMetaUrl: pathToFileURL(join(repoRoot, 'extension-cache/system-extension-manager/backend.mjs')).href,
      relativeSpecifier: '../extensionLifecycle.js',
      normalize: normalizeServerExtensionModuleSpecifier,
    });

    expect(resolved).toBe(pathToFileURL(bundledPath).href);
  });

  it('resolves packaged Extension Manager helper modules from server output', () => {
    const resourcesRoot = makeTempRoot();
    const cwdRoot = makeTempRoot();
    const backendPath = join(resourcesRoot, 'app.asar/server/dist/extensions/extensionBackend.js');
    const doctorPath = join(resourcesRoot, 'app.asar/server/dist/extensions/extensionDoctor.js');
    touch(backendPath);
    touch(doctorPath);
    delete process.env.PERSONAL_AGENT_REPO_ROOT;
    process.chdir(cwdRoot);

    for (const [specifier, expected] of [
      ['../extensionBackend.js', backendPath],
      ['../extensionDoctor.js', doctorPath],
    ] as const) {
      const resolved = resolveServerModuleSpecifierFrom({
        importMetaUrl: pathToFileURL(join(resourcesRoot, 'extensions/system-extension-manager/dist/backend.mjs')).href,
        relativeSpecifier: specifier,
        normalize: normalizeServerExtensionModuleSpecifier,
        resourcesPath: resourcesRoot,
      });

      expect(resolved).toBe(pathToFileURL(expected).href);
    }
  });

  it('resolves packaged server modules inside app.asar before falling back to extension siblings', () => {
    const resourcesRoot = makeTempRoot();
    const cwdRoot = makeTempRoot();
    const appAsarPath = join(resourcesRoot, 'app.asar/server/dist/conversations/sessions.js');
    touch(appAsarPath);
    delete process.env.PERSONAL_AGENT_REPO_ROOT;
    process.chdir(cwdRoot);

    const resolved = resolveServerModuleSpecifierFrom({
      importMetaUrl: pathToFileURL(join(resourcesRoot, 'extensions/system-conversation-tools/dist/backend.mjs')).href,
      relativeSpecifier: '../../conversations/sessions.js',
      resourcesPath: resourcesRoot,
    });

    expect(resolved).toBe(pathToFileURL(appAsarPath).href);
  });

  it('resolves packaged automation modules from bundled server output', () => {
    const resourcesRoot = makeTempRoot();
    const cwdRoot = makeTempRoot();
    const appAsarPath = join(resourcesRoot, 'app.asar/server/dist/automation/deferredResumes.js');
    touch(appAsarPath);
    delete process.env.PERSONAL_AGENT_REPO_ROOT;
    process.chdir(cwdRoot);

    const resolved = resolveServerModuleSpecifierFrom({
      importMetaUrl: pathToFileURL(join(resourcesRoot, 'extensions/system-automations/dist/backend.mjs')).href,
      relativeSpecifier: '../../automation/deferredResumes.js',
      resourcesPath: resourcesRoot,
    });

    expect(resolved).toBe(pathToFileURL(appAsarPath).href);
  });
});
