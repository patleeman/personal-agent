import { spawnSync } from 'child_process';

const ONE_PASSWORD_REFERENCE_PREFIX = 'op://';

interface ResolveOnePasswordReferenceOptions {
  fieldName: string;
  readReference?: (reference: string) => string;
}

export function isOnePasswordReference(value: string): boolean {
  return value.trim().startsWith(ONE_PASSWORD_REFERENCE_PREFIX);
}

function defaultReadOnePasswordReference(reference: string): string {
  const opCommand = process.env.PERSONAL_AGENT_OP_BIN?.trim() || 'op';
  const result = spawnSync(opCommand, ['read', reference], {
    encoding: 'utf-8',
    env: process.env,
  });

  if (result.error) {
    const errorWithCode = result.error as NodeJS.ErrnoException;
    if (errorWithCode.code === 'ENOENT') {
      throw new Error(
        `1Password CLI not found (expected \`${opCommand}\`). Install 1Password CLI or set PERSONAL_AGENT_OP_BIN.`,
      );
    }

    throw new Error(`Failed to execute 1Password CLI: ${result.error.message}`);
  }

  const status = result.status ?? 1;
  if (status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit code ${status}`;
    const authHint = process.env.OP_SERVICE_ACCOUNT_TOKEN
      ? ''
      : ' OP_SERVICE_ACCOUNT_TOKEN may be missing for service-account auth.';
    throw new Error(`${detail}${authHint}`.trim());
  }

  const value = result.stdout?.trim() ?? '';
  if (!value) {
    throw new Error('reference resolved to an empty value');
  }

  return value;
}

export function resolveConfiguredValue(
  value: string | undefined,
  options: ResolveOnePasswordReferenceOptions,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (!isOnePasswordReference(trimmed)) {
    return trimmed;
  }

  const readReference = options.readReference ?? defaultReadOnePasswordReference;

  try {
    return readReference(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${options.fieldName} uses a 1Password reference but it could not be resolved: ${message}`,
    );
  }
}

export function resolveConfiguredAllowlistEntries(
  values: string[] | undefined,
  options: ResolveOnePasswordReferenceOptions,
): Set<string> {
  const allowlist = new Set<string>();

  for (const value of values ?? []) {
    const resolved = resolveConfiguredValue(value, options);
    if (!resolved) {
      continue;
    }

    const parts = resolved
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    for (const part of parts) {
      allowlist.add(part);
    }
  }

  return allowlist;
}
