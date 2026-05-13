import { existsSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { init, parse } from 'es-module-lexer';

import type { ExtensionManifest } from './extensionManifest.js';
import { parseExtensionManifest } from './extensionRegistry.js';
import { findExtensionEntry } from './extensionRegistry.js';

export type ExtensionDoctorSeverity = 'error' | 'warning' | 'info';

export interface ExtensionDoctorFinding {
  severity: ExtensionDoctorSeverity;
  code: string;
  message: string;
  path?: string;
  fix?: string;
}

export interface ExtensionDoctorReport {
  ok: boolean;
  extensionId: string;
  packageRoot: string;
  manifest?: ExtensionManifest;
  findings: ExtensionDoctorFinding[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
}

const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const forbiddenBackendSourceImports = new Set([
  'child_process',
  'node:child_process',
  'cluster',
  'node:cluster',
  'worker_threads',
  'node:worker_threads',
]);
const forbiddenPackagedBackendPrefixes = [
  '@earendil-works/pi-coding-agent',
  '@personal-agent/core',
  '@personal-agent/daemon',
  '@personal-agent/extensions/backend',
  '@sinclair/typebox',
  'jsdom',
];

export async function validateExtensionPackage(input: { extensionId?: string; packageRoot?: string }): Promise<ExtensionDoctorReport> {
  const entry = input.extensionId ? findExtensionEntry(input.extensionId) : null;
  const packageRoot = resolve(input.packageRoot ?? entry?.packageRoot ?? '');
  const findings: ExtensionDoctorFinding[] = [];
  const extensionId = input.extensionId ?? entry?.id ?? packageRoot.split(/[\\/]/).pop() ?? 'extension';

  if (!packageRoot || packageRoot === resolve('')) {
    add(findings, 'error', 'missing-package-root', 'Provide an extension id or packageRoot to validate.');
    return report(extensionId, packageRoot, undefined, findings);
  }

  const manifestPath = resolve(packageRoot, 'extension.json');
  if (!existsSync(manifestPath)) {
    add(
      findings,
      'error',
      'missing-manifest',
      'extension.json is missing.',
      manifestPath,
      'Create an extension.json manifest at the package root.',
    );
    return report(extensionId, packageRoot, undefined, findings);
  }

  let manifest: ExtensionManifest | undefined;
  try {
    manifest = parseExtensionManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  } catch (error) {
    add(
      findings,
      'error',
      'invalid-manifest',
      `extension.json is invalid: ${error instanceof Error ? error.message : String(error)}`,
      manifestPath,
    );
    return report(extensionId, packageRoot, undefined, findings);
  }

  validateManifestReferences(packageRoot, manifest, findings);
  await validateBuiltImports(packageRoot, manifest, findings);
  await validateBackendImport(packageRoot, manifest, findings);

  return report(manifest.id, packageRoot, manifest, findings);
}

function validateManifestReferences(packageRoot: string, manifest: ExtensionManifest, findings: ExtensionDoctorFinding[]) {
  const frontendSource = resolve(packageRoot, 'src', 'frontend.tsx');
  const backendSource = resolve(packageRoot, 'src', 'backend.ts');
  const frontendEntry = manifest.frontend?.entry ? resolve(packageRoot, manifest.frontend.entry) : undefined;
  const backendEntry = manifest.backend?.entry ? resolve(packageRoot, manifest.backend.entry) : undefined;

  if (manifest.frontend?.entry) {
    if (!existsSync(frontendEntry!))
      add(
        findings,
        'error',
        'missing-frontend-dist',
        `Frontend entry is missing: ${manifest.frontend.entry}`,
        frontendEntry,
        'Build the extension.',
      );
    if (!existsSync(frontendSource)) add(findings, 'warning', 'missing-frontend-source', 'src/frontend.tsx is missing.', frontendSource);
    else if (frontendEntry && existsSync(frontendEntry) && statSync(frontendEntry).mtimeMs + 1000 < statSync(frontendSource).mtimeMs) {
      add(
        findings,
        'warning',
        'stale-frontend-dist',
        'dist frontend output is older than src/frontend.tsx.',
        frontendEntry,
        'Rebuild the extension.',
      );
    }
  }

  if (manifest.backend?.entry) {
    if (!existsSync(backendEntry!))
      add(
        findings,
        'error',
        'missing-backend-dist',
        `Backend entry is missing: ${manifest.backend.entry}`,
        backendEntry,
        'Build the extension.',
      );
    if (!existsSync(backendSource)) add(findings, 'warning', 'missing-backend-source', 'src/backend.ts is missing.', backendSource);
    else if (backendEntry && existsSync(backendEntry) && statSync(backendEntry).mtimeMs + 1000 < statSync(backendSource).mtimeMs) {
      add(
        findings,
        'warning',
        'stale-backend-dist',
        'dist backend output is older than src/backend.ts.',
        backendEntry,
        'Rebuild the extension.',
      );
    }
    if (existsSync(backendSource)) validateForbiddenSourceImports(backendSource, findings);
  }

  const frontendContent = existsSync(frontendSource)
    ? readFileSync(frontendSource, 'utf8')
    : frontendEntry && existsSync(frontendEntry)
      ? readFileSync(frontendEntry, 'utf8')
      : '';
  const backendContent = existsSync(backendSource)
    ? readFileSync(backendSource, 'utf8')
    : backendEntry && existsSync(backendEntry)
      ? readFileSync(backendEntry, 'utf8')
      : '';

  for (const component of collectFrontendComponents(manifest)) {
    if (frontendContent && !hasExport(frontendContent, component)) {
      add(
        findings,
        'error',
        'missing-frontend-export',
        `Frontend component "${component}" is referenced by the manifest but is not exported.`,
        frontendSource,
      );
    }
  }

  for (const action of manifest.backend?.actions ?? []) {
    const handler = action.handler ?? action.id;
    if (!handler?.trim()) add(findings, 'error', 'missing-action-handler', `Backend action "${action.id}" is missing a handler.`);
    else if (backendContent && !hasExport(backendContent, handler)) {
      add(
        findings,
        'error',
        'missing-backend-export',
        `Backend handler "${handler}" is referenced by the manifest but is not exported.`,
        backendSource,
      );
    }
  }

  for (const tool of manifest.contributes?.tools ?? []) {
    if (!tool.id?.trim()) add(findings, 'error', 'invalid-tool', 'Tool contribution is missing id.');
    if (!tool.description?.trim()) add(findings, 'error', 'invalid-tool', `Tool "${tool.id}" is missing description.`);
    if (tool.inputSchema?.type !== 'object')
      add(findings, 'error', 'invalid-tool-schema', `Tool "${tool.id}" inputSchema must have type "object".`);
    if (!tool.inputSchema?.properties || typeof tool.inputSchema.properties !== 'object') {
      add(findings, 'error', 'invalid-tool-schema', `Tool "${tool.id}" inputSchema must define properties.`);
    }
  }

  for (const skill of manifest.contributes?.skills ?? []) {
    const skillPath = typeof skill === 'string' ? skill : skill.path;
    if (skillPath && !existsSync(resolve(packageRoot, skillPath)))
      add(findings, 'error', 'missing-skill', `Skill file is missing: ${skillPath}`, resolve(packageRoot, skillPath));
  }
}

async function validateBuiltImports(packageRoot: string, manifest: ExtensionManifest, findings: ExtensionDoctorFinding[]) {
  await init;
  const frontendEntry = manifest.frontend?.entry ? resolve(packageRoot, manifest.frontend.entry) : undefined;
  const backendEntry = manifest.backend?.entry ? resolve(packageRoot, manifest.backend.entry) : undefined;
  if (frontendEntry && existsSync(frontendEntry)) validatePortableImports(frontendEntry, findings, 'frontend');
  if (backendEntry && existsSync(backendEntry)) validatePortableImports(backendEntry, findings, 'backend');
}

async function validateBackendImport(packageRoot: string, manifest: ExtensionManifest, findings: ExtensionDoctorFinding[]) {
  const backendEntry = manifest.backend?.entry ? resolve(packageRoot, manifest.backend.entry) : undefined;
  if (!backendEntry || !existsSync(backendEntry)) return;
  try {
    await import(`${pathToFileURL(backendEntry).href}?paDoctor=${Date.now()}`);
  } catch (error) {
    add(
      findings,
      'error',
      'backend-import-failed',
      `Backend module failed to import: ${error instanceof Error ? error.message : String(error)}`,
      backendEntry,
    );
  }
}

function validatePortableImports(filePath: string, findings: ExtensionDoctorFinding[], side: 'frontend' | 'backend') {
  const source = readFileSync(filePath, 'utf8');
  const [imports] = parse(source);
  for (const importRecord of imports) {
    const specifier = importRecord.n;
    if (!specifier) continue;
    if (specifier.startsWith('/') || specifier.startsWith('file:')) {
      add(
        findings,
        'error',
        'non-portable-import',
        `${side} bundle contains non-portable import: ${specifier}`,
        filePath,
        'Rebuild with the app builder and avoid absolute/file imports.',
      );
      continue;
    }
    if (side === 'backend' && !specifier.startsWith('.') && !specifier.startsWith('data:') && !nodeBuiltins.has(specifier)) {
      if (forbiddenPackagedBackendPrefixes.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`))) {
        add(
          findings,
          'error',
          'forbidden-backend-runtime-import',
          `Backend bundle contains forbidden packaged-runtime import: ${specifier}`,
          filePath,
        );
      }
    }
  }
}

function validateForbiddenSourceImports(filePath: string, findings: ExtensionDoctorFinding[]) {
  const source = readFileSync(filePath, 'utf8');
  for (const specifier of forbiddenBackendSourceImports) {
    if (source.includes(`'${specifier}'`) || source.includes(`"${specifier}"`)) {
      add(
        findings,
        'error',
        'forbidden-process-import',
        `Backend source imports ${specifier}; use ctx.shell or ctx.git instead.`,
        filePath,
      );
    }
  }
}

function collectFrontendComponents(manifest: ExtensionManifest): string[] {
  const contributions = manifest.contributes;
  return [
    ...(contributions?.views ?? []).map((item) => item.component),
    ...(contributions?.composerButtons ?? []).map((item) => item.component),
    ...(contributions?.composerInputTools ?? []).map((item) => item.component),
    ...(contributions?.topBarElements ?? []).map((item) => item.component),
    ...(contributions?.conversationHeaderElements ?? []).map((item) => item.component),
    ...(contributions?.conversationDecorators ?? []).map((item) => item.component),
    ...(contributions?.newConversationPanels ?? []).map((item) => item.component),
    ...(contributions?.statusBarItems ?? []).map((item) => item.component).filter(Boolean),
    ...(contributions?.transcriptRenderers ?? []).map((item) => item.component),
    contributions?.settingsComponent?.component,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function hasExport(source: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`export\\s+(async\\s+)?function\\s+${escaped}\\b`).test(source) ||
    new RegExp(`export\\s+(const|let|var|class)\\s+${escaped}\\b`).test(source) ||
    new RegExp(`export\\s*\\{[^}]*\\b${escaped}\\b`).test(source)
  );
}

function add(
  findings: ExtensionDoctorFinding[],
  severity: ExtensionDoctorSeverity,
  code: string,
  message: string,
  path?: string,
  fix?: string,
) {
  findings.push({ severity, code, message, ...(path ? { path } : {}), ...(fix ? { fix } : {}) });
}

function report(
  extensionId: string,
  packageRoot: string,
  manifest: ExtensionManifest | undefined,
  findings: ExtensionDoctorFinding[],
): ExtensionDoctorReport {
  const summary = {
    errors: findings.filter((finding) => finding.severity === 'error').length,
    warnings: findings.filter((finding) => finding.severity === 'warning').length,
    info: findings.filter((finding) => finding.severity === 'info').length,
  };
  return { ok: summary.errors === 0, extensionId, packageRoot, ...(manifest ? { manifest } : {}), findings, summary };
}
