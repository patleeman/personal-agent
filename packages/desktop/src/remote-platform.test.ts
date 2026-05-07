import { describe, expect, it } from 'vitest';

import { parseRemotePlatform } from './remote-platform.js';

// ── remote-platform — parse OS/arch into platform key ─────────────────────

describe('parseRemotePlatform', () => {
  it('parses darwin/arm64', () => {
    const result = parseRemotePlatform({ os: 'darwin', arch: 'arm64' });
    expect(result.key).toBe('darwin-arm64');
    expect(result.os).toBe('darwin');
    expect(result.arch).toBe('arm64');
  });

  it('parses darwin/aarch64 as arm64', () => {
    const result = parseRemotePlatform({ os: 'darwin', arch: 'aarch64' });
    expect(result.key).toBe('darwin-arm64');
  });

  it('parses darwin/x86_64 as x64', () => {
    const result = parseRemotePlatform({ os: 'darwin', arch: 'x86_64' });
    expect(result.key).toBe('darwin-x64');
  });

  it('parses darwin/amd64 as x64', () => {
    const result = parseRemotePlatform({ os: 'darwin', arch: 'amd64' });
    expect(result.key).toBe('darwin-x64');
  });

  it('parses linux/arm64', () => {
    const result = parseRemotePlatform({ os: 'linux', arch: 'arm64' });
    expect(result.key).toBe('linux-arm64');
  });

  it('parses linux/x64', () => {
    const result = parseRemotePlatform({ os: 'Linux', arch: 'x64' });
    expect(result.key).toBe('linux-x64');
  });

  it('is case-insensitive', () => {
    const result = parseRemotePlatform({ os: 'DARWIN', arch: 'ARM64' });
    expect(result.key).toBe('darwin-arm64');
  });

  it('trims whitespace', () => {
    const result = parseRemotePlatform({ os: '  linux  ', arch: '  x64  ' });
    expect(result.key).toBe('linux-x64');
  });

  it('throws on unsupported OS', () => {
    expect(() => parseRemotePlatform({ os: 'windows', arch: 'x64' })).toThrow('Unsupported');
  });

  it('throws on unsupported arch', () => {
    expect(() => parseRemotePlatform({ os: 'darwin', arch: 'mips' })).toThrow('Unsupported');
  });
});
