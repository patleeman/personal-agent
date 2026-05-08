import { extractMentionIds } from '../knowledge/promptReferences.js';
import { invokeExtensionAction } from './extensionBackend.js';
import { listExtensionPromptReferenceRegistrations } from './extensionRegistry.js';

export interface ExtensionPromptReferenceContextBlock {
  content: string;
}

export interface ExtensionPromptReferenceItem {
  kind: string;
  id: string;
  path?: string;
}

export interface ExtensionPromptReferenceResolution {
  contextBlocks?: ExtensionPromptReferenceContextBlock[];
  references?: ExtensionPromptReferenceItem[];
}

export interface ResolveExtensionPromptReferencesResult {
  contextBlocks: string[];
  references: ExtensionPromptReferenceItem[];
}

function normalizeResolution(value: unknown): ExtensionPromptReferenceResolution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const contextBlocks = Array.isArray(record.contextBlocks)
    ? record.contextBlocks.flatMap((block): ExtensionPromptReferenceContextBlock[] => {
        if (typeof block === 'string' && block.trim()) return [{ content: block }];
        if (block && typeof block === 'object' && !Array.isArray(block) && typeof (block as { content?: unknown }).content === 'string') {
          const content = (block as { content: string }).content;
          return content.trim() ? [{ content }] : [];
        }
        return [];
      })
    : [];
  const references = Array.isArray(record.references)
    ? record.references.flatMap((reference): ExtensionPromptReferenceItem[] => {
        if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return [];
        const candidate = reference as Record<string, unknown>;
        if (typeof candidate.kind !== 'string' || typeof candidate.id !== 'string') return [];
        return [
          {
            kind: candidate.kind,
            id: candidate.id,
            ...(typeof candidate.path === 'string' ? { path: candidate.path } : {}),
          },
        ];
      })
    : [];
  return { contextBlocks, references };
}

export async function resolveExtensionPromptReferences(input: { text: string }): Promise<ResolveExtensionPromptReferencesResult> {
  const mentionIds = extractMentionIds(input.text);
  if (mentionIds.length === 0) {
    return { contextBlocks: [], references: [] };
  }

  const contextBlocks: string[] = [];
  const references: ExtensionPromptReferenceItem[] = [];
  for (const resolver of listExtensionPromptReferenceRegistrations()) {
    const result = await invokeExtensionAction(resolver.extensionId, resolver.handler, { text: input.text, mentionIds });
    const normalized = normalizeResolution(result.result);
    contextBlocks.push(...(normalized.contextBlocks ?? []).map((block) => block.content));
    references.push(...(normalized.references ?? []));
  }

  return { contextBlocks, references };
}
