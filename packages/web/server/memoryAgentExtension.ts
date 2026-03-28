import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  createMemoryDoc,
  filterMemoryDocs,
  lintMemoryDocs,
  loadMemoryDocs,
  resolveMemoryDocById,
} from '@personal-agent/core';

const MEMORY_ACTION_VALUES = ['list', 'find', 'show', 'new', 'lint'] as const;

type MemoryAction = (typeof MEMORY_ACTION_VALUES)[number];

const MemoryToolParams = Type.Object({
  action: Type.Union(MEMORY_ACTION_VALUES.map((value) => Type.Literal(value))),
  memoryId: Type.Optional(Type.String({ description: 'Note node id for show/new actions.' })),
  title: Type.Optional(Type.String({ description: 'Display title stored in note frontmatter for new.' })),
  summary: Type.Optional(Type.String({ description: 'Note node summary for new.' })),
  description: Type.Optional(Type.String({ description: 'Optional agent-facing guidance for how to use the note.' })),
  type: Type.Optional(Type.String({ description: 'Type filter for find or note metadata type for new.' })),
  status: Type.Optional(Type.String({ description: 'Status filter for find or note status for new.' })),
  text: Type.Optional(Type.String({ description: 'Metadata text query for find. Matches id, title, summary, and other note metadata.' })),
  force: Type.Optional(Type.Boolean({ description: 'Overwrite an existing note node when action=new.' })),
});

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function formatParseErrors(parseErrors: Array<{ filePath: string; error: string }>): string[] {
  if (parseErrors.length === 0) {
    return [];
  }

  return [
    `Parse errors (${parseErrors.length}):`,
    ...parseErrors.map((issue) => `- ${issue.filePath}: ${issue.error}`),
  ];
}

function formatMemorySummaryList(docs: Array<{
  id: string;
  title: string;
  type: string;
  status: string;
  updated: string;
  summary: string;
  description?: string;
  filePath: string;
}>): string[] {
  return docs.flatMap((doc) => [
    `- @${doc.id} · ${doc.title} · ${doc.type} · ${doc.status} · updated ${doc.updated}`,
    `  summary: ${doc.summary}`,
    ...(doc.description ? [`  description: ${doc.description}`] : []),
    `  file: ${doc.filePath}`,
  ]);
}

function formatMemoryPackage(doc: {
  id: string;
  title: string;
  type: string;
  status: string;
  updated: string;
  summary: string;
  description?: string;
  filePath: string;
  body: string;
}): string {
  return [
    `Note node @${doc.id}`,
    `title: ${doc.title}`,
    `type: ${doc.type}`,
    `status: ${doc.status}`,
    `updated: ${doc.updated}`,
    `summary: ${doc.summary}`,
    ...(doc.description ? [`description: ${doc.description}`] : []),
    `file: ${doc.filePath}`,
    '',
    doc.body,
  ].join('\n');
}

export function createMemoryAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'memory',
      label: 'Memory',
      description: 'Inspect, search, create, and validate shared note nodes.',
      promptSnippet: 'Use the memory tool when you need to inspect or update durable shared note nodes instead of shelling out to pa memory.',
      promptGuidelines: [
        'Use this tool for shared note-node discovery and validation instead of running pa memory through bash.',
        'Prefer find/show before creating a new note node so you do not duplicate durable knowledge.',
        'Use new to scaffold a valid note node with INDEX.md frontmatter, then edit the file only when you need to add details beyond the scaffold.',
      ],
      parameters: MemoryToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        try {
          switch (params.action as MemoryAction) {
            case 'list': {
              const loaded = loadMemoryDocs();
              const lines = loaded.docs.length > 0
                ? ['Note nodes:', ...formatMemorySummaryList(loaded.docs)]
                : ['No note nodes found.'];
              const parseErrorLines = formatParseErrors(loaded.parseErrors);
              if (parseErrorLines.length > 0) {
                lines.push('', ...parseErrorLines);
              }

              return {
                content: [{ type: 'text' as const, text: lines.join('\n') }],
                details: {
                  action: 'list',
                  memoryDir: loaded.memoryDir,
                  docCount: loaded.docs.length,
                  parseErrorCount: loaded.parseErrors.length,
                  memoryIds: loaded.docs.map((doc) => doc.id),
                },
              };
            }

            case 'find': {
              const loaded = loadMemoryDocs();
              const filteredDocs = filterMemoryDocs(loaded.docs, {
                type: params.type,
                status: params.status,
                text: params.text,
              });

              const lines = [
                'Note node search:',
                `type: ${params.type?.trim() || 'none'}`,
                `status: ${params.status?.trim() || 'none'}`,
                `text: ${params.text?.trim() || 'none'}`,
                '',
                ...(filteredDocs.length > 0
                  ? formatMemorySummaryList(filteredDocs)
                  : ['No note nodes matched the supplied filters.']),
              ];
              const parseErrorLines = formatParseErrors(loaded.parseErrors);
              if (parseErrorLines.length > 0) {
                lines.push('', ...parseErrorLines);
              }

              return {
                content: [{ type: 'text' as const, text: lines.join('\n') }],
                details: {
                  action: 'find',
                  memoryDir: loaded.memoryDir,
                  docCount: filteredDocs.length,
                  parseErrorCount: loaded.parseErrors.length,
                  filters: {
                    type: params.type?.trim() || null,
                    status: params.status?.trim() || null,
                    text: params.text?.trim() || null,
                  },
                  memoryIds: filteredDocs.map((doc) => doc.id),
                },
              };
            }

            case 'show': {
              const loaded = loadMemoryDocs();
              const memoryId = readRequiredString(params.memoryId, 'memoryId');
              const doc = resolveMemoryDocById(loaded.docs, memoryId);
              const lines = [formatMemoryPackage(doc)];
              const parseErrorLines = formatParseErrors(loaded.parseErrors);
              if (parseErrorLines.length > 0) {
                lines.push('', ...parseErrorLines);
              }

              return {
                content: [{ type: 'text' as const, text: lines.join('\n') }],
                details: {
                  action: 'show',
                  memoryDir: loaded.memoryDir,
                  parseErrorCount: loaded.parseErrors.length,
                  memoryId: doc.id,
                  filePath: doc.filePath,
                  type: doc.type,
                  status: doc.status,
                  updated: doc.updated,
                },
              };
            }

            case 'new': {
              const memoryId = readRequiredString(params.memoryId, 'memoryId');
              const title = readRequiredString(params.title, 'title');
              const summary = readRequiredString(params.summary, 'summary');
              const result = createMemoryDoc({
                id: memoryId,
                title,
                summary,
                description: params.description?.trim() || undefined,
                type: params.type,
                status: params.status,
                force: params.force,
              });

              return {
                content: [{
                  type: 'text' as const,
                  text: [
                    `${result.overwritten ? 'Updated' : 'Created'} note node @${result.id}.`,
                    `file: ${result.filePath}`,
                    `type: ${result.type}`,
                    `status: ${result.status}`,
                    `updated: ${result.updated}`,
                  ].join('\n'),
                }],
                details: {
                  action: 'new',
                  memoryDir: result.memoryDir,
                  memoryId: result.id,
                  filePath: result.filePath,
                  overwritten: result.overwritten,
                  type: result.type,
                  status: result.status,
                  updated: result.updated,
                },
              };
            }

            case 'lint': {
              const result = lintMemoryDocs();
              const hasIssues = result.parseErrors.length > 0 || result.duplicateIds.length > 0 || result.referenceErrors.length > 0;
              const lines = [
                'Note node validation',
                `memoryDir: ${result.memoryDir}`,
                `docsParsed: ${result.validDocs}`,
                `parseErrors: ${result.parseErrors.length}`,
                `duplicateIds: ${result.duplicateIds.length}`,
                `referenceErrors: ${result.referenceErrors.length}`,
              ];

              if (!hasIssues) {
                lines.push('', 'All note nodes are valid.');
              }

              if (result.parseErrors.length > 0) {
                lines.push('', 'Parse errors:');
                for (const issue of result.parseErrors) {
                  lines.push(`- ${issue.filePath}: ${issue.error}`);
                }
              }

              if (result.duplicateIds.length > 0) {
                lines.push('', 'Duplicate ids:');
                for (const duplicate of result.duplicateIds) {
                  lines.push(`- ${duplicate.id}: ${duplicate.files.join(', ')}`);
                }
              }

              if (result.referenceErrors.length > 0) {
                lines.push('', 'Reference errors:');
                for (const issue of result.referenceErrors) {
                  lines.push(`- ${issue.id}.${issue.field} -> ${issue.targetId}: ${issue.error}`);
                }
              }

              return {
                content: [{ type: 'text' as const, text: lines.join('\n') }],
                details: {
                  action: 'lint',
                  memoryDir: result.memoryDir,
                  checked: result.checked,
                  validDocs: result.validDocs,
                  parseErrorCount: result.parseErrors.length,
                  duplicateCount: result.duplicateIds.length,
                  referenceErrorCount: result.referenceErrors.length,
                  hasIssues,
                },
              };
            }

            default:
              throw new Error(`Unsupported memory action: ${String(params.action)}`);
          }
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
            isError: true,
            details: {
              action: params.action,
            },
          };
        }
      },
    });
  };
}
