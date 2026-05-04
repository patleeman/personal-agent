import { describe, expect, it, vi } from 'vitest';

import type { DaemonConfig } from '../config.js';
import { getCompanionRuntimeProvider, resolveCompanionRuntime, setCompanionRuntimeProvider } from './runtime.js';

describe('companion runtime provider', () => {
  it('returns undefined initially', () => {
    expect(getCompanionRuntimeProvider()).toBeUndefined();
  });

  it('set and get provider', () => {
    const provider = vi.fn();
    setCompanionRuntimeProvider(provider);
    expect(getCompanionRuntimeProvider()).toBe(provider);
  });

  it('set to undefined clears the provider', () => {
    const provider = vi.fn();
    setCompanionRuntimeProvider(provider);
    setCompanionRuntimeProvider(undefined);
    expect(getCompanionRuntimeProvider()).toBeUndefined();
  });

  it('resolveCompanionRuntime returns null when no provider is set', async () => {
    setCompanionRuntimeProvider(undefined);
    const result = await resolveCompanionRuntime({} as DaemonConfig);
    expect(result).toBeNull();
  });

  it('resolveCompanionRuntime delegates to the provider', async () => {
    const mockRuntime = { name: 'test' };
    const provider = vi.fn().mockResolvedValue(mockRuntime);
    setCompanionRuntimeProvider(provider);

    const config = { logLevel: 'info' } as DaemonConfig;
    const result = await resolveCompanionRuntime(config);
    expect(provider).toHaveBeenCalledWith(config);
    expect(result).toBe(mockRuntime);
  });

  it('resolveCompanionRuntime handles provider rejection', async () => {
    const provider = vi.fn().mockRejectedValue(new Error('provider failed'));
    setCompanionRuntimeProvider(provider);

    await expect(resolveCompanionRuntime({} as DaemonConfig)).rejects.toThrow('provider failed');
  });
});
