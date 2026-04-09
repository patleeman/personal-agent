import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pickFolderMock } = vi.hoisted(() => ({
  pickFolderMock: vi.fn(),
}));

vi.mock('../workspace/folderPicker.js', () => ({
  pickFolder: pickFolderMock,
}));

import { registerFolderPickerRoutes } from './folderPicker.js';

describe('registerFolderPickerRoutes', () => {
  beforeEach(() => {
    pickFolderMock.mockReset();
  });

  function createHarness(options?: {
    getDefaultWebCwd?: () => string;
    resolveRequestedCwd?: (cwd: string | undefined, defaultCwd: string) => string | undefined;
  }) {
    let postHandler: ((req: any, res: any) => void) | undefined;
    const router = {
      post: vi.fn((path: string, next: typeof postHandler) => {
        expect(path).toBe('/api/folder-picker');
        postHandler = next;
      }),
    };

    registerFolderPickerRoutes(router as never, {
      getDefaultWebCwd: options?.getDefaultWebCwd ?? (() => '/workspace/default'),
      resolveRequestedCwd: options?.resolveRequestedCwd ?? ((cwd) => cwd),
    });

    return {
      postHandler: postHandler!,
    };
  }

  function createResponse() {
    return {
      json: vi.fn(),
    };
  }

  it('passes the resolved cwd to the folder picker', () => {
    const resolveRequestedCwd = vi.fn(() => '/workspace/resolved');
    const { postHandler } = createHarness({ resolveRequestedCwd });
    const res = createResponse();
    pickFolderMock.mockReturnValue({ canceled: false, filePaths: ['/workspace/resolved'] });

    postHandler({ body: { cwd: '/workspace/requested' } }, res);

    expect(resolveRequestedCwd).toHaveBeenCalledWith('/workspace/requested', '/workspace/default');
    expect(pickFolderMock).toHaveBeenCalledWith({
      initialDirectory: '/workspace/resolved',
      prompt: 'Choose working directory',
    });
    expect(res.json).toHaveBeenCalledWith({ canceled: false, filePaths: ['/workspace/resolved'] });
  });

  it('falls back to the default cwd when resolution returns nothing', () => {
    const { postHandler } = createHarness({
      getDefaultWebCwd: () => '/workspace/fallback',
      resolveRequestedCwd: () => undefined,
    });
    const res = createResponse();
    pickFolderMock.mockReturnValue({ canceled: true, filePaths: [] });

    postHandler({ body: {} }, res);

    expect(pickFolderMock).toHaveBeenCalledWith({
      initialDirectory: '/workspace/fallback',
      prompt: 'Choose working directory',
    });
    expect(res.json).toHaveBeenCalledWith({ canceled: true, filePaths: [] });
  });
});
