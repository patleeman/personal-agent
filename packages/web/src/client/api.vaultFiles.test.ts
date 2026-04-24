import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('api.vaultFiles', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('uses HTTP even on the local desktop host', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      root: '/vault',
      files: [{ id: 'notes/a.md', kind: 'file', name: 'a.md', path: '/vault/notes/a.md', sizeBytes: 12, updatedAt: '2026-04-18T12:00:00.000Z' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
        }),
        readVaultFiles: vi.fn(),
      },
      location: { pathname: '/knowledge' },
      sessionStorage: { getItem: () => null },
    } as unknown as Window & typeof globalThis);
    vi.stubGlobal('document', {
      documentElement: { dataset: {} },
    } as unknown as Document);
    vi.stubGlobal('navigator', { userAgent: 'Electron' } as Navigator);

    const { api } = await import('./api');
    const result = await api.vaultFiles();

    expect(fetchMock).toHaveBeenCalledWith('/api/vault-files', { method: 'GET', cache: 'no-store' });
    expect(result).toEqual({
      root: '/vault',
      files: [{ id: 'notes/a.md', kind: 'file', name: 'a.md', path: '/vault/notes/a.md', sizeBytes: 12, updatedAt: '2026-04-18T12:00:00.000Z' }],
    });
  });
});
