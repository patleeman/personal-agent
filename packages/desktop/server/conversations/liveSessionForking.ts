import { readFileSync } from 'node:fs';

import type { ParallelPromptJob } from './liveSessionParallelJobs.js';

export function resolveLastCompletedConversationEntryId(sessionFile: string): string | null {
  const lines = readFileSync(sessionFile, 'utf-8').split(/\r?\n/);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const rawLine = lines[index]?.trim();
    if (!rawLine) {
      continue;
    }

    try {
      const entry = JSON.parse(rawLine) as {
        type?: string;
        id?: string;
        message?: { role?: string };
      };
      if (entry.type !== 'message') {
        continue;
      }
      if (entry.message?.role !== 'user' && entry.message?.role !== 'assistant') {
        continue;
      }
      const entryId = entry.id?.trim();
      if (entryId) {
        return entryId;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export interface StableForkBranchEntry {
  id?: string;
  parentId?: string | null;
  type?: string;
  display?: boolean;
  message?: {
    role?: string;
    content?: unknown;
    stopReason?: string;
    errorMessage?: string;
  };
}

function isHiddenCustomMessageEntry(entry: StableForkBranchEntry | undefined): boolean {
  return entry?.type === 'custom_message' && entry.display === false;
}

export function getStableForkBranchEntries(sessionFile: string): StableForkBranchEntry[] {
  try {
    return readFileSync(sessionFile, 'utf-8')
      .split(/\r?\n/)
      .flatMap((line): StableForkBranchEntry[] => {
        const rawLine = line.trim();
        if (!rawLine) {
          return [];
        }

        try {
          const entry = JSON.parse(rawLine) as StableForkBranchEntry;
          return typeof entry.id === 'string' && entry.id.trim().length > 0
            ? [
                {
                  ...entry,
                  id: entry.id.trim(),
                  parentId: typeof entry.parentId === 'string' ? entry.parentId.trim() : (entry.parentId ?? null),
                },
              ]
            : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function isStableCompletedBranchEntry(entry: StableForkBranchEntry | undefined): boolean {
  if (!entry) {
    return false;
  }

  if (entry.type === 'custom_message') {
    return entry.display === true;
  }

  if (entry.type === 'compaction' || entry.type === 'branch_summary') {
    return true;
  }

  if (entry.type !== 'message') {
    return false;
  }

  if (entry.message?.role !== 'assistant') {
    return false;
  }

  return entry.message.stopReason !== 'toolUse';
}

export function resolveStableForkEntryId(sessionFile: string, options: { activeTurnInProgress?: boolean } = {}): string | null {
  const branch = getStableForkBranchEntries(sessionFile);
  if (branch.length === 0) {
    return null;
  }

  if (!options.activeTurnInProgress) {
    return branch[branch.length - 1]?.id?.trim() || null;
  }

  const branchById = new Map(
    branch
      .filter((entry): entry is StableForkBranchEntry & { id: string } => typeof entry.id === 'string' && entry.id.trim().length > 0)
      .map((entry) => [entry.id.trim(), entry]),
  );

  let latestUserIndex = -1;
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type === 'message' && entry.message?.role === 'user') {
      latestUserIndex = index;
      break;
    }
  }

  if (latestUserIndex >= 0) {
    const latestUserEntry = branch[latestUserIndex];
    const hasStableCompletedEntryAfterLatestUser = branch.slice(latestUserIndex + 1).some((entry) => isStableCompletedBranchEntry(entry));

    if (!hasStableCompletedEntryAfterLatestUser) {
      let current: StableForkBranchEntry | undefined = latestUserEntry?.parentId ? branchById.get(latestUserEntry.parentId) : undefined;
      while (current && isHiddenCustomMessageEntry(current)) {
        current = current.parentId ? branchById.get(current.parentId) : undefined;
      }
      return current?.id?.trim() || null;
    }
  }

  let current: StableForkBranchEntry | undefined = branch[branch.length - 1];
  while (current && isHiddenCustomMessageEntry(current)) {
    current = current.parentId ? branchById.get(current.parentId) : undefined;
  }

  return current?.id?.trim() || null;
}

export function extractTextFromMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .flatMap((part) =>
      part &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string'
        ? [(part as { text: string }).text]
        : [],
    )
    .join('\n')
    .trim();
}

function formatParallelQuotedSection(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n');
}

export function buildParallelImportedContent(
  job: Pick<
    ParallelPromptJob,
    | 'prompt'
    | 'childConversationId'
    | 'resultText'
    | 'error'
    | 'imageCount'
    | 'attachmentRefs'
    | 'touchedFiles'
    | 'parentTouchedFiles'
    | 'overlapFiles'
    | 'sideEffects'
  >,
): string {
  const attachmentRefs = Array.isArray(job.attachmentRefs) ? job.attachmentRefs : [];
  const touchedFiles = Array.isArray(job.touchedFiles) ? job.touchedFiles : [];
  const parentTouchedFiles = Array.isArray(job.parentTouchedFiles) ? job.parentTouchedFiles : [];
  const overlapFiles = Array.isArray(job.overlapFiles) ? job.overlapFiles : [];
  const sideEffects = Array.isArray(job.sideEffects) ? job.sideEffects : [];
  const childHref = `/conversations/${encodeURIComponent(job.childConversationId)}`;
  const promptText = job.prompt.trim().length > 0 ? job.prompt.trim() : '(image-only prompt)';
  const sections = ['### Parallel response', '', `[Open side thread](${childHref})`, ''];

  const metadata: string[] = [];
  if (job.imageCount > 0) {
    metadata.push(`- Images: ${job.imageCount}`);
  }
  if (attachmentRefs.length > 0) {
    metadata.push('- Attachments:', ...attachmentRefs.map((attachmentRef) => `  - ${attachmentRef}`));
  }
  if (touchedFiles.length > 0) {
    metadata.push('- Touched files:', ...touchedFiles.map((path) => `  - \`${path}\``));
  }
  if (parentTouchedFiles.length > 0) {
    metadata.push('- Parent thread touched:', ...parentTouchedFiles.map((path) => `  - \`${path}\``));
  }
  if (metadata.length > 0) {
    sections.push('**Metadata**', '', ...metadata, '');
  }

  if (overlapFiles.length > 0) {
    sections.push(
      '**Potential overlap**',
      '',
      'These files changed in the worktree while this side thread was running and may need a manual conflict check.',
      '',
      ...overlapFiles.map((path) => `- \`${path}\``),
      '',
    );
  }

  if (sideEffects.length > 0) {
    sections.push('**Side effects**', '', ...sideEffects.map((summary) => `- ${summary}`), '');
  }

  sections.push('**Prompt**', '', formatParallelQuotedSection(promptText), '');

  if (job.error?.trim()) {
    sections.push('**Status**', '', 'Failed', '');
    sections.push('**Error**', '', job.error.trim());
  } else {
    sections.push('**Reply**', '', job.resultText?.trim() || '(No text reply. Open the side thread for the full result.)');
  }

  return sections.join('\n');
}
