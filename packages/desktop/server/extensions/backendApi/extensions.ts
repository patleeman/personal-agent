type ExtensionLifecycleModule = typeof import('../extensionLifecycle.js');
type ExtensionBackendModule = typeof import('../extensionBackend.js');
type ExtensionDoctorModule = typeof import('../extensionDoctor.js');
type ExtensionRegistryModule = typeof import('../extensionRegistry.js');

type RuntimeExtensionCreateOptions = Parameters<ExtensionLifecycleModule['createRuntimeExtension']>[0];
type ValidateExtensionPackageOptions = Parameters<ExtensionDoctorModule['validateExtensionPackage']>[0];

const dynamicImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

async function importExtensionLifecycle(): Promise<ExtensionLifecycleModule> {
  return dynamicImport<ExtensionLifecycleModule>('../extensionLifecycle.js');
}

async function importExtensionBackend(): Promise<ExtensionBackendModule> {
  return dynamicImport<ExtensionBackendModule>('../extensionBackend.js');
}

async function importExtensionDoctor(): Promise<ExtensionDoctorModule> {
  return dynamicImport<ExtensionDoctorModule>('../extensionDoctor.js');
}

async function importExtensionRegistry(): Promise<ExtensionRegistryModule> {
  return dynamicImport<ExtensionRegistryModule>('../extensionRegistry.js');
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
