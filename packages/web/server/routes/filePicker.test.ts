import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pickFilesMock } = vi.hoisted(() => ({
  pickFilesMock: vi.fn(),
}));

vi.mock('../workspace/filePicker.js', () => ({
  pickFiles: pickFilesMock,
}));

import { registerFilePickerRoutes } from './filePicker.js';

describe('registerFilePickerRoutes', () => {
  beforeEach(() => {
    pickFilesMock.mockReset();
  });

  function createHarness(options?: {
    getDefaultWebCwd?: () => string;
    resolveRequestedCwd?: (cwd: string | undefined, defaultCwd: string) => string | undefined;
  }) {
    let postHandler: ((req: { body?: { cwd?: string | null } }, res: ReturnType<typeof createResponse>) => void) | undefined;
    const router = {
      post: vi.fn((path: string, next: typeof postHandler) => {
        expect(path).toBe('/api/file-picker');
        postHandler = next;
      }),
    };

    registerFilePickerRoutes(router as never, {
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

  it('passes the resolved cwd to the file picker', () => {
    const resolveRequestedCwd = vi.fn(() => '/workspace/resolved');
    const { postHandler } = createHarness({ resolveRequestedCwd });
    const res = createResponse();
    pickFilesMock.mockReturnValue({ paths: ['/workspace/resolved/AGENTS.md'], cancelled: false });

    postHandler({ body: { cwd: '/workspace/requested' } }, res);

    expect(resolveRequestedCwd).toHaveBeenCalledWith('/workspace/requested', '/workspace/default');
    expect(pickFilesMock).toHaveBeenCalledWith({
      initialDirectory: '/workspace/resolved',
      prompt: 'Choose instruction files',
    });
    expect(res.json).toHaveBeenCalledWith({ paths: ['/workspace/resolved/AGENTS.md'], cancelled: false });
  });

  it('falls back to the default cwd when resolution returns nothing', () => {
    const { postHandler } = createHarness({
      getDefaultWebCwd: () => '/workspace/fallback',
      resolveRequestedCwd: () => undefined,
    });
    const res = createResponse();
    pickFilesMock.mockReturnValue({ paths: [], cancelled: true });

    postHandler({ body: {} }, res);

    expect(pickFilesMock).toHaveBeenCalledWith({
      initialDirectory: '/workspace/fallback',
      prompt: 'Choose instruction files',
    });
    expect(res.json).toHaveBeenCalledWith({ paths: [], cancelled: true });
  });
});
