import type { ExtensionBackendContext } from '@personal-agent/extensions';
import {
  buildRuntimeExtension,
  createRuntimeExtension,
  listExtensionInstallSummaries,
  reloadExtensionBackend,
  snapshotRuntimeExtension,
  validateExtensionPackage,
} from '@personal-agent/extensions/backend/extensions';

interface ExtensionIdInput {
  id?: unknown;
  extensionId?: unknown;
}

export async function listExtensions(_input: unknown, _ctx: ExtensionBackendContext) {
  return { ok: true, extensions: listExtensionInstallSummaries() };
}

export async function createExtension(input: unknown, _ctx: ExtensionBackendContext) {
  const body = asRecord(input);
  const result = createRuntimeExtension({
    id: body.id,
    name: body.name,
    description: body.description,
    template: body.template,
  });
  return { ok: true, ...result };
}

export async function snapshotExtension(input: ExtensionIdInput, _ctx: ExtensionBackendContext) {
  const extensionId = requireExtensionId(input);
  return { ok: true, ...(snapshotRuntimeExtension(extensionId) as object) };
}

export async function buildExtension(input: ExtensionIdInput, _ctx: ExtensionBackendContext) {
  const extensionId = requireExtensionId(input);
  const result = await buildRuntimeExtension(extensionId);
  return { ok: true, ...result };
}

export async function reloadExtension(input: ExtensionIdInput, _ctx: ExtensionBackendContext) {
  const extensionId = requireExtensionId(input);
  const result = await reloadExtensionBackend(extensionId);
  return { ok: true, ...result };
}

export async function validateExtension(input: unknown, _ctx: ExtensionBackendContext) {
  const body = asRecord(input);
  const extensionId = typeof body.id === 'string' ? body.id : typeof body.extensionId === 'string' ? body.extensionId : undefined;
  const packageRoot = typeof body.packageRoot === 'string' ? body.packageRoot : undefined;
  return validateExtensionPackage({ extensionId, packageRoot });
}

export async function manageExtension(input: unknown, ctx: ExtensionBackendContext) {
  const body = asRecord(input);
  const action = typeof body.action === 'string' ? body.action : 'list';
  if (action === 'list') return listExtensions(input, ctx);
  if (action === 'create') return createExtension(input, ctx);
  if (action === 'snapshot') return snapshotExtension(input as ExtensionIdInput, ctx);
  if (action === 'build') return buildExtension(input as ExtensionIdInput, ctx);
  if (action === 'reload') return reloadExtension(input as ExtensionIdInput, ctx);
  if (action === 'validate') return validateExtension(input, ctx);
  throw new Error(`Unsupported extension manager action: ${action}`);
}

function requireExtensionId(input: ExtensionIdInput): string {
  const extensionId = typeof input?.extensionId === 'string' ? input.extensionId : typeof input?.id === 'string' ? input.id : undefined;
  if (!extensionId?.trim()) throw new Error('extension id is required.');
  return extensionId.trim();
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}
