import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  createMemoryDoc,
  filterMemoryDocs,
  lintMemoryDocs,
  loadMemoryDocs,
  resolveMemoryDocById,
  splitMemoryTagValues,
} from '@personal-agent/core';

const MEMORY_ACTION_VALUES = ['list', 'find', 'show', 'new', 'lint'] as const;

type MemoryAction = (typeof MEMORY_ACTION_VALUES)[number];

const MemoryToolParams = Type.Object({
  action: Type.Union(MEMORY_ACTION_VALUES.map((value) => Type.Literal(value))),
  memoryId: Type.Optional(Type.String({ description: 'Memory doc id for show/new actions.' })),
  title: Type.Optional(Type.String({ description: 'Memory doc title for new.' })),
  summary: Type.Optional(Type.String({ description: 'Memory doc summary for new.' })),
  tags: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: 'Tags for find/new. For find, all supplied tags must match.' })),
  type: Type.Optional(Type.String({ description: 'Type filter for find or memory doc type for new.' })),
  status: Type.Optional(Type.String({ description: 'Status filter for find or memory doc status for new.' })),
  text: Type.Optional(Type.String({ description: 'Metadata text query for find. Matches id, title, summary, and tags.' })),
  force: Type.Optional(Type.Boolean({ description: 'Overwrite an existing memory doc when action=new.' })),
});

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function formatMemoryTags(tags: string[]): string {
  return tags.length > 0 ? tags.join(', ') : 'none';
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
  tags: string[];
  summary: string;
  filePath: string;
}>): string[] {
  return docs.flatMap((doc) => [
    `- @${doc.id} · ${doc.title} · ${doc.type} · ${doc.status} · updated ${doc.updated}`,
    `  tags: ${formatMemoryTags(doc.tags)}`,
    `  summary: ${doc.summary}`,
    `  file: ${doc.filePath}`,
  ]);
}

function normalizeTags(tags: string[] | undefined): string[] {
  return splitMemoryTagValues(tags ?? []);
}

function formatMemoryDoc(doc: {
  id: string;
  title: string;
  type: string;
  status: string;
  updated: string;
  tags: string[];
  summary: string;
  filePath: string;
  body: string;
}): string {
  return [
    `Memory doc @${doc.id}`,
    `title: ${doc.title}`,
    `type: ${doc.type}`,
    `status: ${doc.status}`,
    `updated: ${doc.updated}`,
    `tags: ${formatMemoryTags(doc.tags)}`,
    `summary: ${doc.summary}`,
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
      description: 'Inspect, search, create, and validate global memory docs.',
      promptSnippet: 'Use the memory tool when you need to inspect or update durable global memory docs instead of shelling out to pa memory.',
      promptGuidelines: [
        'Use this tool for global memory doc discovery and validation instead of running pa memory through bash.',
        'Prefer find/show before creating a new memory doc so you do not duplicate durable knowledge.',
        'Use new to scaffold a valid memory doc template with frontmatter, then edit the file only when you need to add details beyond the scaffold.',
      ],
      parameters: MemoryToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        try {
          switch (params.action as MemoryAction) {
            case 'list': {
              const loaded = loadMemoryDocs();
              const lines = loaded.docs.length > 0
                ? ['Memory docs:', ...formatMemorySummaryList(loaded.docs)]
                : ['No memory docs found.'];
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
              const tags = normalizeTags(params.tags);
              const filteredDocs = filterMemoryDocs(loaded.docs, {
                tags,
                type: params.type,
                status: params.status,
                text: params.text,
              });

              const lines = [
                'Memory doc search:',
                `tags: ${tags.length > 0 ? tags.join(', ') : 'none'}`,
                `type: ${params.type?.trim() || 'none'}`,
                `status: ${params.status?.trim() || 'none'}`,
                `text: ${params.text?.trim() || 'none'}`,
                '',
                ...(filteredDocs.length > 0
                  ? formatMemorySummaryList(filteredDocs)
                  : ['No memory docs matched the supplied filters.']),
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
                    tags,
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
              const lines = [formatMemoryDoc(doc)];
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
                  tags: doc.tags,
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
              const tags = normalizeTags(params.tags);
              const result = createMemoryDoc({
                id: memoryId,
                title,
                summary,
                type: params.type,
                status: params.status,
                tags,
                force: params.force,
              });

              return {
                content: [{
                  type: 'text' as const,
                  text: [
                    `${result.overwritten ? 'Updated' : 'Created'} memory @${result.id}.`,
                    `file: ${result.filePath}`,
                    `type: ${result.type}`,
                    `status: ${result.status}`,
                    `tags: ${formatMemoryTags(result.tags)}`,
                    `updated: ${result.updated}`,
                  ].join('\n'),
                }],
                details: {
                  action: 'new',
                  memoryDir: result.memoryDir,
                  memoryId: result.id,
                  filePath: result.filePath,
                  overwritten: result.overwritten,
                  tags: result.tags,
                  type: result.type,
                  status: result.status,
                  updated: result.updated,
                },
              };
            }

            case 'lint': {
              const result = lintMemoryDocs();
              const hasIssues = result.parseErrors.length > 0 || result.duplicateIds.length > 0;
              const lines = [
                'Memory validation',
                `memoryDir: ${result.memoryDir}`,
                `docsParsed: ${result.validDocs}`,
                `parseErrors: ${result.parseErrors.length}`,
                `duplicateIds: ${result.duplicateIds.length}`,
              ];

              if (!hasIssues) {
                lines.push('', 'All memory docs are valid.');
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

              return {
                content: [{ type: 'text' as const, text: lines.join('\n') }],
                details: {
                  action: 'lint',
                  memoryDir: result.memoryDir,
                  checked: result.checked,
                  validDocs: result.validDocs,
                  parseErrorCount: result.parseErrors.length,
                  duplicateCount: result.duplicateIds.length,
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
