import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type ExtensionLifecycleModule = typeof import('../extensionLifecycle.js');
type ExtensionBackendModule = typeof import('../extensionBackend.js');
type ExtensionDoctorModule = typeof import('../extensionDoctor.js');
type ExtensionRegistryModule = typeof import('../extensionRegistry.js');

type RuntimeExtensionCreateOptions = Parameters<ExtensionLifecycleModule['createRuntimeExtension']>[0];
type ValidateExtensionPackageOptions = Parameters<ExtensionDoctorModule['validateExtensionPackage']>[0];

const dynamicImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

function resolveServerExtensionModuleSpecifier(relativeSpecifier: string): string {
  const normalized = relativeSpecifier.replace(/^\.\.\//, 'extensions/').replace(/^\/+/, '');
  const candidates = [
    ...(process.env.PERSONAL_AGENT_REPO_ROOT
      ? [
          resolve(process.env.PERSONAL_AGENT_REPO_ROOT, 'packages/desktop/dist/server', normalized),
          resolve(process.env.PERSONAL_AGENT_REPO_ROOT, 'packages/desktop/server/dist', normalized),
        ]
      : []),
    resolve(process.cwd(), 'packages/desktop/dist/server', normalized),
    resolve(process.cwd(), 'packages/desktop/server/dist', normalized),
    resolve(dirname(fileURLToPath(import.meta.url)), relativeSpecifier),
    ...(typeof process.resourcesPath === 'string'
      ? [
          resolve(process.resourcesPath, 'app.asar.unpacked/packages/desktop/dist/server', normalized),
          resolve(process.resourcesPath, 'app.asar.unpacked/packages/desktop/server/dist', normalized),
          resolve(process.resourcesPath, 'app.asar.unpacked/server/dist', normalized),
          resolve(process.resourcesPath, 'server/dist', normalized),
        ]
      : []),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found ? pathToFileURL(found).href : relativeSpecifier;
}

async function importExtensionLifecycle(): Promise<ExtensionLifecycleModule> {
  return dynamicImport<ExtensionLifecycleModule>(resolveServerExtensionModuleSpecifier('../extensionLifecycle.js'));
}

async function importExtensionBackend(): Promise<ExtensionBackendModule> {
  return dynamicImport<ExtensionBackendModule>(resolveServerExtensionModuleSpecifier('../extensionBackend.js'));
}

async function importExtensionDoctor(): Promise<ExtensionDoctorModule> {
  return dynamicImport<ExtensionDoctorModule>(resolveServerExtensionModuleSpecifier('../extensionDoctor.js'));
}

async function importExtensionRegistry(): Promise<ExtensionRegistryModule> {
  return dynamicImport<ExtensionRegistryModule>(resolveServerExtensionModuleSpecifier('../extensionRegistry.js'));
}

export async function buildRuntimeExtension(extensionId: string) {
  const module = await importExtensionLifecycle();
  return module.buildRuntimeExtension(extensionId);
}

export async function createRuntimeExtension(options: RuntimeExtensionCreateOptions) {
  const module = await importExtensionLifecycle();
  return module.createRuntimeExtension(options);
}

export async function snapshotRuntimeExtension(extensionId: string) {
  const module = await importExtensionLifecycle();
  return module.snapshotRuntimeExtension(extensionId);
}

export async function reloadExtensionBackend(extensionId: string) {
  const module = await importExtensionBackend();
  return module.reloadExtensionBackend(extensionId);
}

export async function validateExtensionPackage(options: ValidateExtensionPackageOptions) {
  const module = await importExtensionDoctor();
  return module.validateExtensionPackage(options);
}

export async function listExtensionInstallSummaries() {
  const module = await importExtensionRegistry();
  return module.listExtensionInstallSummaries();
}

export type { ExtensionDoctorFinding, ExtensionDoctorReport, ExtensionDoctorSeverity } from '../extensionDoctor.js';
