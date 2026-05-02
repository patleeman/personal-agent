import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getVaultRootMock,
  listVaultFilesMock,
  pickFolderMock,
} = vi.hoisted(() => ({
  getVaultRootMock: vi.fn(),
  listVaultFilesMock: vi.fn(),
  pickFolderMock: vi.fn(),
}));

vi.mock('@personal-agent/core', () => ({
  getVaultRoot: getVaultRootMock,
}));

vi.mock('../knowledge/vaultFiles.js', () => ({
  listVaultFiles: listVaultFilesMock,
}));

vi.mock('./folderPicker.js', () => ({
  pickFolder: pickFolderMock,
}));

import { pickFolderCapability, readVaultFilesCapability } from './workspaceDesktopCapability.js';

beforeEach(() => {
  getVaultRootMock.mockReset();
  listVaultFilesMock.mockReset();
  pickFolderMock.mockReset();

  getVaultRootMock.mockReturnValue('/vault');
  listVaultFilesMock.mockReturnValue([{ id: 'notes/a.md', kind: 'file', name: 'a.md', path: '/vault/notes/a.md', sizeBytes: 12, updatedAt: '2026-04-18T12:00:00.000Z' }]);
  pickFolderMock.mockReturnValue({ path: '/workspace/selected', cancelled: false });
});

describe('workspaceDesktopCapability', () => {
  it('reads vault files from the current vault root', () => {
    expect(readVaultFilesCapability()).toEqual({
      root: '/vault',
      files: [{ id: 'notes/a.md', kind: 'file', name: 'a.md', path: '/vault/notes/a.md', sizeBytes: 12, updatedAt: '2026-04-18T12:00:00.000Z' }],
    });
    expect(listVaultFilesMock).toHaveBeenCalledWith('/vault');
  });

  it('picks folders using resolved cwd fallback rules', () => {
    const context = {
      getDefaultWebCwd: () => '/workspace/default',
      resolveRequestedCwd: vi.fn(() => '/workspace/resolved'),
    };

    expect(pickFolderCapability({ cwd: '~/repo' }, context)).toEqual({ path: '/workspace/selected', cancelled: false });
    expect(context.resolveRequestedCwd).toHaveBeenCalledWith('~/repo', '/workspace/default');
    expect(pickFolderMock).toHaveBeenCalledWith({
      initialDirectory: '/workspace/resolved',
      prompt: 'Choose working directory',
    });
  });

  it('falls back to the default cwd when requested cwd does not resolve', () => {
    const context = {
      getDefaultWebCwd: () => '/workspace/default',
      resolveRequestedCwd: vi.fn(() => undefined),
    };

    expect(pickFolderCapability({}, context)).toEqual({ path: '/workspace/selected', cancelled: false });
    expect(pickFolderMock).toHaveBeenCalledWith({
      initialDirectory: '/workspace/default',
      prompt: 'Choose working directory',
    });
  });
});
