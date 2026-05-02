import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyPatch,
  buildApplyPatchSummary,
  parseApplyPatch,
  seekSequence,
  shouldUseApplyPatchTool,
  synchronizeActiveTools,
} from './applyPatch';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'personal-agent-apply-patch-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('gpt apply_patch helper', () => {
  it('detects GPT-family models and swaps tool names without injecting new editing tools', () => {
    expect(shouldUseApplyPatchTool({ id: 'gpt-5.4' })).toBe(true);
    expect(shouldUseApplyPatchTool({ id: 'claude-sonnet-4-5' })).toBe(false);

    expect(synchronizeActiveTools(['read', 'bash', 'edit', 'write'], { id: 'gpt-5.4' })).toEqual(['read', 'bash', 'apply_patch', 'write']);

    expect(synchronizeActiveTools(['read', 'bash', 'apply_patch', 'write'], { id: 'claude-sonnet-4-5' })).toEqual([
      'read',
      'bash',
      'edit',
      'write',
    ]);

    expect(synchronizeActiveTools(['read', 'bash', 'write'], { id: 'gpt-5.4' })).toEqual(['read', 'bash', 'write']);

    expect(synchronizeActiveTools(['read', 'edit', 'apply_patch', 'write'], { id: 'gpt-5.4' })).toEqual(['read', 'apply_patch', 'write']);
  });

  it('parses add, delete, update, and move operations from a single patch envelope', () => {
    const cwd = '/repo';
    const operations = parseApplyPatch(
      `*** Begin Patch
*** Add File: notes/todo.txt
+first line
+second line
*** Delete File: notes/old.txt
*** Update File: src/app.ts
*** Move to: src/main.ts
@@ class Example
-oldValue
+newValue
*** End Patch`,
      cwd,
    );

    expect(operations).toEqual([
      {
        type: 'add',
        path: 'notes/todo.txt',
        absolutePath: '/repo/notes/todo.txt',
        contents: 'first line\nsecond line\n',
      },
      {
        type: 'delete',
        path: 'notes/old.txt',
        absolutePath: '/repo/notes/old.txt',
      },
      {
        type: 'update',
        path: 'src/app.ts',
        absolutePath: '/repo/src/app.ts',
        moveTo: 'src/main.ts',
        moveToAbsolutePath: '/repo/src/main.ts',
        chunks: [
          {
            changeContext: 'class Example',
            oldLines: ['oldValue'],
            newLines: ['newValue'],
            isEndOfFile: false,
          },
        ],
      },
    ]);
  });

  it('matches chunk context with progressively looser search rules', () => {
    const lines = ['    import asyncio  # local import – avoids top‑level dep   '];
    const pattern = ['import asyncio  # local import - avoids top-level dep'];
    expect(seekSequence(lines, pattern, 0, false)).toBe(0);
  });

  it('applies add, update, delete, and rename operations with a git-style summary', async () => {
    const dir = await createTempDir();
    await writeFile(join(dir, 'delete-me.txt'), 'remove me\n', 'utf8');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'app.ts'), 'const value = 1;\n', 'utf8');

    const result = await applyPatch(
      `*** Begin Patch
*** Add File: notes/todo.txt
+ship tests
*** Delete File: delete-me.txt
*** Update File: src/app.ts
*** Move to: src/main.ts
@@
-const value = 1;
+const value = 2;
*** End Patch`,
      dir,
    );

    expect(result).toEqual({
      added: ['notes/todo.txt'],
      modified: ['src/main.ts'],
      deleted: ['delete-me.txt'],
      summary: 'Success. Updated the following files:\nA notes/todo.txt\nM src/main.ts\nD delete-me.txt',
    });

    await expect(readFile(join(dir, 'notes', 'todo.txt'), 'utf8')).resolves.toBe('ship tests\n');
    await expect(readFile(join(dir, 'src', 'main.ts'), 'utf8')).resolves.toBe('const value = 2;\n');
    await expect(readFile(join(dir, 'delete-me.txt'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(dir, 'src', 'app.ts'), 'utf8')).rejects.toThrow();
  });

  it('applies multiple update hunks including explicit end-of-file additions', async () => {
    const dir = await createTempDir();
    const filePath = join(dir, 'interleaved.txt');
    await writeFile(filePath, 'a\nb\nc\nd\ne\nf\n', 'utf8');

    const result = await applyPatch(
      `*** Begin Patch
*** Update File: interleaved.txt
@@
 a
-b
+B
@@
 c
 d
-e
+E
@@
 f
+g
*** End of File
*** End Patch`,
      dir,
    );

    expect(result.summary).toBe('Success. Updated the following files:\nM interleaved.txt');
    await expect(readFile(filePath, 'utf8')).resolves.toBe('a\nB\nc\nd\nE\nf\ng\n');
  });

  it('keeps matching resilient to unicode punctuation differences', async () => {
    const dir = await createTempDir();
    const filePath = join(dir, 'unicode.py');
    await writeFile(filePath, 'import asyncio  # local import – avoids top‑level dep\n', 'utf8');

    await applyPatch(
      `*** Begin Patch
*** Update File: unicode.py
@@
-import asyncio  # local import - avoids top-level dep
+import asyncio  # HELLO
*** End Patch`,
      dir,
    );

    await expect(readFile(filePath, 'utf8')).resolves.toBe('import asyncio  # HELLO\n');
  });

  it('rejects absolute paths and paths that escape the working directory', async () => {
    const dir = await createTempDir();

    await expect(
      applyPatch(
        `*** Begin Patch
*** Add File: /tmp/evil.txt
+nope
*** End Patch`,
        dir,
      ),
    ).rejects.toThrow('paths must be relative');

    await expect(
      applyPatch(
        `*** Begin Patch
*** Add File: ../evil.txt
+nope
*** End Patch`,
        dir,
      ),
    ).rejects.toThrow('working directory');
  });

  it('fails when update hunks cannot be matched against the target file', async () => {
    const dir = await createTempDir();
    const filePath = join(dir, 'source.txt');
    await writeFile(filePath, 'original content\n', 'utf8');

    await expect(
      applyPatch(
        `*** Begin Patch
*** Update File: source.txt
@@
-missing content
+new content
*** End Patch`,
        dir,
      ),
    ).rejects.toThrow('Failed to find expected lines');
  });

  it('builds a no-op summary when status transitions cancel out', () => {
    expect(buildApplyPatchSummary({ added: [], modified: [], deleted: [] })).toBe('Success. No files changed.');
  });
});
