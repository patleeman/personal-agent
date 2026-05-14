export interface RuntimeExtensionCreateOptions {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  template?: unknown;
}

export interface RuntimeExtensionResult {
  [key: string]: unknown;
}

export interface ExtensionInstallSummary {
  [key: string]: unknown;
}

export interface ExtensionDoctorReport {
  ok?: boolean;
  [key: string]: unknown;
}

export async function buildRuntimeExtension(_extensionId: string): Promise<RuntimeExtensionResult> {
  throw new Error('@personal-agent/extensions/backend/extensions must be resolved by the Personal Agent host runtime.');
}

export async function createRuntimeExtension(_options: RuntimeExtensionCreateOptions): Promise<RuntimeExtensionResult> {
  throw new Error('@personal-agent/extensions/backend/extensions must be resolved by the Personal Agent host runtime.');
}

export async function listExtensionInstallSummaries(): Promise<ExtensionInstallSummary[]> {
  throw new Error('@personal-agent/extensions/backend/extensions must be resolved by the Personal Agent host runtime.');
}

export async function reloadExtensionBackend(_extensionId: string): Promise<RuntimeExtensionResult> {
  throw new Error('@personal-agent/extensions/backend/extensions must be resolved by the Personal Agent host runtime.');
}

export async function snapshotRuntimeExtension(_extensionId: string): Promise<RuntimeExtensionResult> {
  throw new Error('@personal-agent/extensions/backend/extensions must be resolved by the Personal Agent host runtime.');
}

export async function validateExtensionPackage(_options: { extensionId?: string; packageRoot?: string }): Promise<ExtensionDoctorReport> {
  throw new Error('@personal-agent/extensions/backend/extensions must be resolved by the Personal Agent host runtime.');
}
