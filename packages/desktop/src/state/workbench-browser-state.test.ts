import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../desktop-env.js', () => ({
  resolveDesktopRuntimePaths: () => ({ desktopStateDir: process.env.TEST_DESKTOP_STATE_DIR }),
}));

afterEach(() => {
  delete process.env.TEST_DESKTOP_STATE_DIR;
});

describe('workbench browser state', () => {
  it('persists and restores the last browser URL per session key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-workbench-browser-state-'));
    process.env.TEST_DESKTOP_STATE_DIR = dir;
    const mod = await import('./workbench-browser-state.js');

    mod.writeStoredWorkbenchBrowserUrl('conversation-1', 'example.com');
    expect(mod.readStoredWorkbenchBrowserUrl('conversation-1')).toBeNull();

    mod.writeStoredWorkbenchBrowserUrl('conversation-1', 'https://example.com/path');
    mod.writeStoredWorkbenchBrowserUrl('conversation-2', 'https://other.example/');

    expect(mod.readStoredWorkbenchBrowserUrl('conversation-1')).toBe('https://example.com/path');
    expect(mod.readStoredWorkbenchBrowserUrl('conversation-2')).toBe('https://other.example/');
    expect(JSON.parse(readFileSync(join(dir, 'workbench-browser-state.json'), 'utf-8')).entries).toHaveLength(2);
  });

  it('drops unsafe persisted entries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-workbench-browser-state-'));
    process.env.TEST_DESKTOP_STATE_DIR = dir;
    writeFileSync(join(dir, 'workbench-browser-state.json'), JSON.stringify({
      version: 1,
      entries: [
        { sessionKey: 'ok', url: 'https://example.com/', updatedAt: '2026-04-01T00:00:00.000Z' },
        { sessionKey: 'bad', url: 'file:///etc/passwd', updatedAt: '2026-04-01T00:00:00.000Z' },
      ],
    }));
    const mod = await import('./workbench-browser-state.js');

    expect(mod.readStoredWorkbenchBrowserUrl('ok')).toBe('https://example.com/');
    expect(mod.readStoredWorkbenchBrowserUrl('bad')).toBeNull();
  });
});
