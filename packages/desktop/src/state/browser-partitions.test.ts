import { describe, expect, it } from 'vitest';
import { getHostBrowserPartition } from './browser-partitions.js';

describe('getHostBrowserPartition', () => {
  it('builds a persistent partition name for a host id', () => {
    expect(getHostBrowserPartition('local')).toBe('persist:pa-host-local');
  });

  it('sanitizes mixed-case ids and punctuation', () => {
    expect(getHostBrowserPartition('Home Tailnet / GPU')).toBe('persist:pa-host-home-tailnet-gpu');
  });

  it('falls back to a safe token when the id is empty', () => {
    expect(getHostBrowserPartition('   ')).toBe('persist:pa-host-host');
  });
});
