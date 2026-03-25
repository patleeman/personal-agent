import { describe, expect, it } from 'vitest';
import {
  canPromptCompanionInstall,
  isCompanionPath,
  isCompanionSecureContext,
  isCompanionStandalone,
} from './pwa.js';

describe('companion PWA helpers', () => {
  it('detects companion app routes under /app', () => {
    expect(isCompanionPath('/app')).toBe(true);
    expect(isCompanionPath('/app/conversations')).toBe(true);
    expect(isCompanionPath('/conversations')).toBe(false);
  });

  it('treats https and localhost as secure install contexts', () => {
    expect(isCompanionSecureContext({ protocol: 'https:', hostname: 'agent.tail.ts.net' }, false)).toBe(true);
    expect(isCompanionSecureContext({ protocol: 'http:', hostname: 'localhost' }, false)).toBe(true);
    expect(isCompanionSecureContext({ protocol: 'http:', hostname: '127.0.0.1' }, false)).toBe(true);
    expect(isCompanionSecureContext({ protocol: 'http:', hostname: 'example.com' }, false)).toBe(false);
  });

  it('recognizes standalone display mode', () => {
    expect(isCompanionStandalone(true, false)).toBe(true);
    expect(isCompanionStandalone(false, true)).toBe(true);
    expect(isCompanionStandalone(false, false)).toBe(false);
  });

  it('only offers the custom install prompt when the companion app can actually prompt', () => {
    expect(canPromptCompanionInstall({ secureContext: true, standalone: false, hasDeferredPrompt: true })).toBe(true);
    expect(canPromptCompanionInstall({ secureContext: false, standalone: false, hasDeferredPrompt: true })).toBe(false);
    expect(canPromptCompanionInstall({ secureContext: true, standalone: true, hasDeferredPrompt: true })).toBe(false);
    expect(canPromptCompanionInstall({ secureContext: true, standalone: false, hasDeferredPrompt: false })).toBe(false);
  });
});
