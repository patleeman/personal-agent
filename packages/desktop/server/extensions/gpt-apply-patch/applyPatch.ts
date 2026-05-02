import { constants } from 'node:fs';
import { access, mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { withFileMutationQueue } from '@mariozechner/pi-coding-agent';

const BEGIN_PATCH_MARKER = '*** Begin Patch';
const END_PATCH_MARKER = '*** End Patch';
const ADD_FILE_MARKER = '*** Add File: ';
const DELETE_FILE_MARKER = '*** Delete File: ';
const UPDATE_FILE_MARKER = '*** Update File: ';
const MOVE_TO_MARKER = '*** Move to: ';
const EOF_MARKER = '*** End of File';
const CHANGE_CONTEXT_MARKER = '@@ ';
const EMPTY_CHANGE_CONTEXT_MARKER = '@@';

type ModelLike = { id?: unknown };

type AddFileOperation = {
  type: 'add';
  path: string;
  absolutePath: string;
  contents: string;
};

type DeleteFileOperation = {
  type: 'delete';
  path: string;
  absolutePath: string;
};

type UpdateFileOperation = {
  type: 'update';
  path: string;
  absolutePath: string;
  moveTo?: string;
  moveToAbsolutePath?: string;
  chunks: UpdateFileChunk[];
};

export type ApplyPatchOperation = AddFileOperation | DeleteFileOperation | UpdateFileOperation;

export type UpdateFileChunk = {
  changeContext?: string;
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
};

export type ApplyPatchResult = {
  added: string[];
  modified: string[];
  deleted: string[];
  summary: string;
};

export const APPLY_PATCH_PROMPT_SNIPPET = 'Edit files with apply_patch envelopes by sending the full patch text in the input field';

export const APPLY_PATCH_PROMPT_GUIDELINES = [
  'When apply_patch is available, send the full patch in the input field using *** Begin Patch / *** End Patch.',
  'Use relative file paths in apply_patch patches; never use absolute paths or paths that escape the working directory.',
  'Prefer apply_patch over exact string replacement when making GPT-model file edits.',
] as const;

export const APPLY_PATCH_DESCRIPTION = `Use the \`apply_patch\` tool to edit files.
Your patch language is a stripped-down, file-oriented diff format.

*** Begin Patch
[ one or more file sections ]
*** End Patch

Each file section starts with one of:
- *** Add File: <path>
- *** Delete File: <path>
- *** Update File: <path>

\`*** Update File\` may be followed by \`*** Move to: <new path>\` for renames.
Then add one or more hunks introduced by \`@@\` or \`@@ <context>\`.
Within a hunk, each line starts with one of:
- \` \` for unchanged context
- \`-\` for removed lines
- \`+\` for added lines

Send the full patch in the \`input\` field.
File references must be relative and must stay inside the current working directory.`;

export function shouldUseApplyPatchTool(model: ModelLike | null | undefined): boolean {
  return typeof model?.id === 'string' && model.id.startsWith('gpt-');
}

export function synchronizeActiveTools(activeTools: readonly string[], model: ModelLike | null | undefined): string[] {
  const preferredTool = shouldUseApplyPatchTool(model) ? 'apply_patch' : 'edit';
  const alternateTool = preferredTool === 'apply_patch' ? 'edit' : 'apply_patch';
  const synchronized: string[] = [];
  let sawEditingTool = false;

  for (const toolName of activeTools) {
    if (toolName === preferredTool || toolName === alternateTool) {
      if (!sawEditingTool) {
        synchronized.push(preferredTool);
        sawEditingTool = true;
      }
      continue;
    }

    if (!synchronized.includes(toolName)) {
      synchronized.push(toolName);
    }
  }

  return synchronized;
}

export function parseApplyPatch(input: string, cwd: string): ApplyPatchOperation[] {
  const patch = normalizePatchInput(input);
  const lines = patch.split('\n');

  if (lines[0]?.trim() !== BEGIN_PATCH_MARKER) {
    throw new Error(`The first line of the patch must be '${BEGIN_PATCH_MARKER}'.`);
  }

  if (lines[lines.length - 1]?.trim() !== END_PATCH_MARKER) {
    throw new Error(`The last line of the patch must be '${END_PATCH_MARKER}'.`);
  }

  const bodyLines = lines.slice(1, -1);
  if (bodyLines.length === 0) {
    throw new Error('The patch body must contain at least one file operation.');
  }

  const operations: ApplyPatchOperation[] = [];
  let index = 0;
  while (index < bodyLines.length) {
    const line = bodyLines[index]?.trim() ?? '';

    if (line.startsWith(ADD_FILE_MARKER)) {
      const path = resolvePatchPath(cwd, line.slice(ADD_FILE_MARKER.length), 'Add File');
      index += 1;
      const addedLines: string[] = [];
      while (index < bodyLines.length && bodyLines[index]?.startsWith('+')) {
        addedLines.push(bodyLines[index]!.slice(1));
        index += 1;
      }

      if (addedLines.length === 0) {
        throw new Error(`Add File operations must include at least one '+' line for ${path.patchPath}.`);
      }

      operations.push({
        type: 'add',
        path: path.patchPath,
        absolutePath: path.absolutePath,
        contents: `${addedLines.join('\n')}\n`,
      });
      continue;
    }

    if (line.startsWith(DELETE_FILE_MARKER)) {
      const path = resolvePatchPath(cwd, line.slice(DELETE_FILE_MARKER.length), 'Delete File');
      operations.push({
        type: 'delete',
        path: path.patchPath,
        absolutePath: path.absolutePath,
      });
      index += 1;
      continue;
    }

    if (line.startsWith(UPDATE_FILE_MARKER)) {
      const path = resolvePatchPath(cwd, line.slice(UPDATE_FILE_MARKER.length), 'Update File');
      index += 1;

      let moveTo: string | undefined;
      let moveToAbsolutePath: string | undefined;
      if (index < bodyLines.length && bodyLines[index]?.trim().startsWith(MOVE_TO_MARKER)) {
        const moveTarget = resolvePatchPath(cwd, bodyLines[index]!.trim().slice(MOVE_TO_MARKER.length), 'Move to');
        moveTo = moveTarget.patchPath;
        moveToAbsolutePath = moveTarget.absolutePath;
        index += 1;
      }

      const chunks: UpdateFileChunk[] = [];
      while (index < bodyLines.length && !isFileHeaderLine(bodyLines[index]!)) {
        const header = bodyLines[index]!.trim();
        if (!(header === EMPTY_CHANGE_CONTEXT_MARKER || header.startsWith(CHANGE_CONTEXT_MARKER))) {
          throw new Error(`'${bodyLines[index]}' is not a valid hunk header.`);
        }

        const changeContext = header === EMPTY_CHANGE_CONTEXT_MARKER ? undefined : header.slice(CHANGE_CONTEXT_MARKER.length);
        index += 1;

        const oldLines: string[] = [];
        const newLines: string[] = [];
        let isEndOfFile = false;
        let sawChangeLine = false;

        while (index < bodyLines.length) {
          const currentLine = bodyLines[index]!;
          const trimmedCurrentLine = currentLine.trim();
          if (trimmedCurrentLine === EOF_MARKER) {
            isEndOfFile = true;
            index += 1;
            break;
          }
          if (trimmedCurrentLine === EMPTY_CHANGE_CONTEXT_MARKER || trimmedCurrentLine.startsWith(CHANGE_CONTEXT_MARKER)) {
            break;
          }
          if (isFileHeaderLine(currentLine)) {
            break;
          }

          const prefix = currentLine[0];
          const content = currentLine.slice(1);
          if (prefix === '+') {
            newLines.push(content);
          } else if (prefix === '-') {
            oldLines.push(content);
          } else if (prefix === ' ') {
            oldLines.push(content);
            newLines.push(content);
          } else {
            throw new Error(`Invalid hunk line '${currentLine}' in ${path.patchPath}.`);
          }

          sawChangeLine = true;
          index += 1;
        }

        if (!sawChangeLine) {
          throw new Error(`Update File hunks must include at least one change line for ${path.patchPath}.`);
        }

        chunks.push({ changeContext, oldLines, newLines, isEndOfFile });
      }

      if (!moveTo && chunks.length === 0) {
        throw new Error(`Update File operations must include a rename or at least one hunk for ${path.patchPath}.`);
      }

      operations.push({
        type: 'update',
        path: path.patchPath,
        absolutePath: path.absolutePath,
        moveTo,
        moveToAbsolutePath,
        chunks,
      });
      continue;
    }

    throw new Error(
      `'${
        bodyLines[index]
      }' is not a valid file operation header. Valid headers: '${ADD_FILE_MARKER}{path}', '${DELETE_FILE_MARKER}{path}', '${UPDATE_FILE_MARKER}{path}'.`,
    );
  }

  return operations;
}

export async function applyPatch(input: string, cwd: string): Promise<ApplyPatchResult> {
  const operations = parseApplyPatch(input, cwd);
  const touchedPaths = operations.flatMap((operation) => {
    if (operation.type === 'update' && operation.moveToAbsolutePath) {
      return [operation.absolutePath, operation.moveToAbsolutePath];
    }
    return [operation.absolutePath];
  });

  const tracker = createStatusTracker();
  await withSortedMutationQueues(touchedPaths, async () => {
    for (const operation of operations) {
      if (operation.type === 'add') {
        await applyAddFile(operation);
        tracker.record(operation.path, 'A');
        continue;
      }

      if (operation.type === 'delete') {
        await applyDeleteFile(operation);
        tracker.record(operation.path, 'D');
        continue;
      }

      await applyUpdateFile(operation);
      tracker.record(operation.moveTo ?? operation.path, 'M');
    }
  });

  const result = tracker.result();
  return {
    ...result,
    summary: buildApplyPatchSummary(result),
  };
}

export function buildApplyPatchSummary(result: Omit<ApplyPatchResult, 'summary'>): string {
  if (result.added.length === 0 && result.modified.length === 0 && result.deleted.length === 0) {
    return 'Success. No files changed.';
  }

  const lines = ['Success. Updated the following files:'];
  for (const path of result.added) lines.push(`A ${path}`);
  for (const path of result.modified) lines.push(`M ${path}`);
  for (const path of result.deleted) lines.push(`D ${path}`);
  return lines.join('\n');
}

async function applyAddFile(operation: AddFileOperation): Promise<void> {
  if (await pathExists(operation.absolutePath)) {
    throw new Error(`Cannot add ${operation.path}: file already exists.`);
  }

  await mkdir(resolve(operation.absolutePath, '..'), { recursive: true });
  await writeFile(operation.absolutePath, operation.contents, 'utf8');
}

async function applyDeleteFile(operation: DeleteFileOperation): Promise<void> {
  const metadata = await stat(operation.absolutePath).catch(() => undefined);
  if (!metadata) {
    throw new Error(`Cannot delete ${operation.path}: file does not exist.`);
  }
  if (metadata.isDirectory()) {
    throw new Error(`Cannot delete ${operation.path}: path is a directory.`);
  }

  await rm(operation.absolutePath);
}

async function applyUpdateFile(operation: UpdateFileOperation): Promise<void> {
  const metadata = await stat(operation.absolutePath).catch(() => undefined);
  if (!metadata) {
    throw new Error(`Cannot update ${operation.path}: file does not exist.`);
  }
  if (metadata.isDirectory()) {
    throw new Error(`Cannot update ${operation.path}: path is a directory.`);
  }

  const originalContents = await readFile(operation.absolutePath, 'utf8');
  const nextContents = deriveUpdatedContents(operation, originalContents);
  const destination = operation.moveToAbsolutePath ?? operation.absolutePath;

  await mkdir(resolve(destination, '..'), { recursive: true });
  await writeFile(destination, nextContents, 'utf8');

  if (operation.moveToAbsolutePath && operation.moveToAbsolutePath !== operation.absolutePath) {
    await unlink(operation.absolutePath);
  }
}

function deriveUpdatedContents(operation: UpdateFileOperation, originalContents: string): string {
  const preferredNewline = detectPreferredNewline(originalContents);
  const originalLines = splitFileLines(originalContents);
  const replacements = computeReplacements(originalLines, operation.path, operation.chunks);
  const nextLines = applyReplacements(originalLines, replacements);
  return joinFileLines(nextLines, preferredNewline);
}

function computeReplacements(
  originalLines: string[],
  path: string,
  chunks: UpdateFileChunk[],
): Array<{ startIndex: number; oldLength: number; newLines: string[] }> {
  const replacements: Array<{ startIndex: number; oldLength: number; newLines: string[] }> = [];
  let lineIndex = 0;

  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const contextIndex = seekSequence(originalLines, [chunk.changeContext], lineIndex, false);
      if (contextIndex === undefined) {
        throw new Error(`Failed to find context '${chunk.changeContext}' in ${path}.`);
      }
      lineIndex = contextIndex + 1;
    }

    if (chunk.oldLines.length === 0) {
      const insertionIndex = originalLines.length;
      replacements.push({ startIndex: insertionIndex, oldLength: 0, newLines: [...chunk.newLines] });
      continue;
    }

    let pattern = [...chunk.oldLines];
    let replacementLines = [...chunk.newLines];
    let matchIndex = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);

    if (matchIndex === undefined && pattern.at(-1) === '') {
      pattern = pattern.slice(0, -1);
      if (replacementLines.at(-1) === '') {
        replacementLines = replacementLines.slice(0, -1);
      }
      matchIndex = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
    }

    if (matchIndex === undefined) {
      throw new Error(`Failed to find expected lines in ${path}:\n${chunk.oldLines.join('\n')}`);
    }

    replacements.push({ startIndex: matchIndex, oldLength: pattern.length, newLines: replacementLines });
    lineIndex = matchIndex + pattern.length;
  }

  return replacements.sort((left, right) => left.startIndex - right.startIndex);
}

function applyReplacements(lines: string[], replacements: Array<{ startIndex: number; oldLength: number; newLines: string[] }>): string[] {
  const nextLines = [...lines];
  for (const replacement of [...replacements].reverse()) {
    nextLines.splice(replacement.startIndex, replacement.oldLength, ...replacement.newLines);
  }
  return nextLines;
}

export function seekSequence(lines: readonly string[], pattern: readonly string[], start: number, eof: boolean): number | undefined {
  if (pattern.length === 0) {
    return start;
  }
  if (pattern.length > lines.length) {
    return undefined;
  }

  const maxStartIndex = lines.length - pattern.length;
  const searchStart = eof && lines.length >= pattern.length ? Math.max(0, maxStartIndex) : Math.max(0, start);

  const matchers = [
    (left: string, right: string) => left === right,
    (left: string, right: string) => left.trimEnd() === right.trimEnd(),
    (left: string, right: string) => left.trim() === right.trim(),
    (left: string, right: string) => normalizeForLooseMatch(left) === normalizeForLooseMatch(right),
  ];

  for (const matcher of matchers) {
    for (let index = searchStart; index <= maxStartIndex; index += 1) {
      let matched = true;
      for (let patternIndex = 0; patternIndex < pattern.length; patternIndex += 1) {
        if (!matcher(lines[index + patternIndex]!, pattern[patternIndex]!)) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return index;
      }
    }
  }

  return undefined;
}

function normalizeForLooseMatch(value: string): string {
  return value
    .trim()
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, ' ');
}

function detectPreferredNewline(content: string): '\n' | '\r\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function splitFileLines(content: string): string[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

function joinFileLines(lines: string[], newline: '\n' | '\r\n'): string {
  if (lines.length === 0) {
    return '';
  }
  return `${lines.join(newline)}${newline}`;
}

function normalizePatchInput(input: string): string {
  const normalized = input.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    throw new Error('Patch input must not be empty.');
  }
  return normalized;
}

function isFileHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith(ADD_FILE_MARKER) || trimmed.startsWith(DELETE_FILE_MARKER) || trimmed.startsWith(UPDATE_FILE_MARKER);
}

function resolvePatchPath(cwd: string, patchPath: string, label: string): { patchPath: string; absolutePath: string } {
  const normalizedPatchPath = patchPath.replace(/\\/g, '/').trim();
  if (!normalizedPatchPath) {
    throw new Error(`${label} paths must not be empty.`);
  }
  if (isAbsolute(normalizedPatchPath)) {
    throw new Error(`${label} paths must be relative, never absolute: ${normalizedPatchPath}`);
  }

  const absolutePath = resolve(cwd, normalizedPatchPath);
  const relativePath = relative(cwd, absolutePath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`${label} paths must stay within the working directory: ${normalizedPatchPath}`);
  }

  return {
    patchPath: normalizedPatchPath,
    absolutePath,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function withSortedMutationQueues<T>(paths: readonly string[], fn: () => Promise<T>): Promise<T> {
  const uniquePaths = [...new Set(paths)].sort((left, right) => left.localeCompare(right));
  let index = 0;

  const run = async (): Promise<T> => {
    const currentPath = uniquePaths[index];
    if (!currentPath) {
      return fn();
    }
    index += 1;
    return withFileMutationQueue(currentPath, run);
  };

  return run();
}

type FileStatus = 'A' | 'M' | 'D';

function createStatusTracker() {
  const order: string[] = [];
  const statuses = new Map<string, FileStatus>();

  return {
    record(path: string, status: FileStatus) {
      if (!order.includes(path)) {
        order.push(path);
      }

      const previousStatus = statuses.get(path);
      if (status === 'A') {
        statuses.set(path, 'A');
        return;
      }

      if (status === 'M') {
        if (!previousStatus) {
          statuses.set(path, 'M');
        }
        return;
      }

      if (previousStatus === 'A') {
        statuses.delete(path);
        return;
      }

      statuses.set(path, 'D');
    },

    result(): Omit<ApplyPatchResult, 'summary'> {
      const added: string[] = [];
      const modified: string[] = [];
      const deleted: string[] = [];

      for (const path of order) {
        const status = statuses.get(path);
        if (!status) {
          continue;
        }
        if (status === 'A') {
          added.push(path);
        } else if (status === 'M') {
          modified.push(path);
        } else {
          deleted.push(path);
        }
      }

      return { added, modified, deleted };
    },
  };
}
