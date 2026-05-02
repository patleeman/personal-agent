import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SecretResolverModule = typeof import('./secret-resolver.js');

const originalEnv = process.env;

async function loadModuleWithSpawnSync(
  spawnSyncMock: ReturnType<typeof vi.fn>,
): Promise<SecretResolverModule> {
  vi.doMock('child_process', () => ({
    spawnSync: spawnSyncMock,
  }));

  return import('./secret-resolver.js');
}

describe('secret resolver default 1Password reader', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses configured op binary and timeout when resolving references', async () => {
    process.env.PERSONAL_AGENT_OP_BIN = ' /custom/op ';
    process.env.PERSONAL_AGENT_OP_READ_TIMEOUT_MS = '2500';

    const spawnSyncMock = vi.fn(() => ({
      status: 0,
      stdout: '  resolved-secret  ',
      stderr: '',
    }));

    const mod = await loadModuleWithSpawnSync(spawnSyncMock);

    const resolved = mod.resolveConfiguredValue('op://Assistant/ITEM/field', {
      fieldName: 'TOKEN',
    });

    expect(resolved).toBe('resolved-secret');
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      '/custom/op',
      ['--cache=false', 'read', 'op://Assistant/ITEM/field'],
      expect.objectContaining({
        encoding: 'utf-8',
        timeout: 2500,
      }),
    );
  });

  it('falls back to default timeout when timeout env var is invalid', async () => {
    process.env.PERSONAL_AGENT_OP_READ_TIMEOUT_MS = 'invalid';

    const timeoutError = Object.assign(new Error('timed out'), {
      code: 'ETIMEDOUT',
    });

    const spawnSyncMock = vi.fn(() => ({
      error: timeoutError,
      status: null,
      stdout: '',
      stderr: '',
    }));

    const mod = await loadModuleWithSpawnSync(spawnSyncMock);

    expect(() => mod.resolveConfiguredValue('op://Assistant/ITEM/field', {
      fieldName: 'TOKEN',
    })).toThrow('timed out after 15000ms while reading 1Password reference');
  });

  it('surfaces a clear error when the 1Password CLI binary is missing', async () => {
    const missingBinaryError = Object.assign(new Error('ENOENT'), {
      code: 'ENOENT',
    });

    const spawnSyncMock = vi.fn(() => ({
      error: missingBinaryError,
      status: null,
      stdout: '',
      stderr: '',
    }));

    const mod = await loadModuleWithSpawnSync(spawnSyncMock);

    expect(() => mod.resolveConfiguredValue('op://Assistant/ITEM/field', {
      fieldName: 'TOKEN',
    })).toThrow('1Password CLI not found');
  });

  it('adds authentication hint when CLI exits non-zero without service account token', async () => {
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;

    const spawnSyncMock = vi.fn(() => ({
      status: 1,
      stdout: '',
      stderr: 'permission denied',
      signal: null,
    }));

    const mod = await loadModuleWithSpawnSync(spawnSyncMock);

    expect(() => mod.resolveConfiguredValue('op://Assistant/ITEM/field', {
      fieldName: 'TOKEN',
    })).toThrow('permission denied OP_SERVICE_ACCOUNT_TOKEN may be missing for service-account auth.');
  });

  it('omits auth hint when service-account token is present', async () => {
    process.env.OP_SERVICE_ACCOUNT_TOKEN = 'token-present';

    const spawnSyncMock = vi.fn(() => ({
      status: 2,
      stdout: '',
      stderr: '',
      signal: 'SIGTERM',
    }));

    const mod = await loadModuleWithSpawnSync(spawnSyncMock);

    expect(() => mod.resolveConfiguredValue('op://Assistant/ITEM/field', {
      fieldName: 'TOKEN',
    })).toThrow('exit code 2 (signal: SIGTERM)');

    expect(() => mod.resolveConfiguredValue('op://Assistant/ITEM/field', {
      fieldName: 'TOKEN',
    })).not.toThrow('OP_SERVICE_ACCOUNT_TOKEN may be missing');
  });

  it('throws when the reference resolves to an empty value', async () => {
    const spawnSyncMock = vi.fn(() => ({
      status: 0,
      stdout: '   ',
      stderr: '',
    }));

    const mod = await loadModuleWithSpawnSync(spawnSyncMock);

    expect(() => mod.resolveConfiguredValue('op://Assistant/ITEM/field', {
      fieldName: 'TOKEN',
    })).toThrow('reference resolved to an empty value');
  });
});
