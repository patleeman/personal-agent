import { describe, expect, it } from 'vitest';
import { isTrustedOrigin, resolveRequestOrigin } from './webSecurity.js';

describe('resolveRequestOrigin', () => {
  it('prefers forwarded host and protocol when present', () => {
    expect(resolveRequestOrigin({
      host: '127.0.0.1:3742',
      protocol: 'http',
      forwardedHost: 'agent.tail.ts.net',
      forwardedProto: 'https',
    })).toBe('https://agent.tail.ts.net');
  });

  it('falls back to direct host and protocol', () => {
    expect(resolveRequestOrigin({
      host: '127.0.0.1:3741',
      protocol: 'http',
    })).toBe('http://127.0.0.1:3741');
  });
});

describe('isTrustedOrigin', () => {
  it('accepts matching origins', () => {
    expect(isTrustedOrigin('https://agent.tail.ts.net', 'https://agent.tail.ts.net')).toBe(true);
  });

  it('rejects missing or mismatched origins', () => {
    expect(isTrustedOrigin(undefined, 'https://agent.tail.ts.net')).toBe(false);
    expect(isTrustedOrigin('https://evil.example', 'https://agent.tail.ts.net')).toBe(false);
    expect(isTrustedOrigin('not-a-url', 'https://agent.tail.ts.net')).toBe(false);
  });
});
