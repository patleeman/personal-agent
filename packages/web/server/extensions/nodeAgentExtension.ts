import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  createUnifiedNode,
  deleteUnifiedNode,
  findUnifiedNodeById,
  findUnifiedNodes,
  lintUnifiedNodes,
  loadUnifiedNodes,
  tagUnifiedNode,
  updateUnifiedNode,
} from '@personal-agent/core';

const NODE_ACTION_VALUES = ['list', 'find', 'show', 'get', 'new', 'update', 'delete', 'tag', 'lint'] as const;

type NodeAction = (typeof NODE_ACTION_VALUES)[number];

const NodeToolParams = Type.Object({
  action: Type.Union(NODE_ACTION_VALUES.map((value) => Type.Literal(value))),
  nodeId: Type.Optional(Type.String({ description: 'Page id for show/get/new/update/delete/tag actions.' })),
  title: Type.Optional(Type.String({ description: 'Display title stored in page frontmatter.' })),
  summary: Type.Optional(Type.String({ description: 'One-sentence page summary.' })),
  description: Type.Optional(Type.String({ description: 'Optional agent-facing guidance for how to use the page.' })),
  status: Type.Optional(Type.String({ description: 'Status field for the page.' })),
  query: Type.Optional(Type.String({ description: 'Lucene-style page query for list/find.' })),
  body: Type.Optional(Type.String({ description: 'Full markdown body for create/update.' })),
  addTags: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  removeTags: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  tags: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  parent: Type.Optional(Type.String({ description: 'Optional parent page id.' })),
  related: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  force: Type.Optional(Type.Boolean({ description: 'Overwrite an existing page when action=new.' })),
});

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function formatParseErrors(parseErrors: Array<{ filePath: string; error: string }>): string[] {
  if (parseErrors.length === 0) return [];
  return ['Parse errors:', ...parseErrors.map((issue) => `- ${issue.filePath}: ${issue.error}`)];
}

function formatNodeSummaryList(nodes: Array<{
  id: string;
  title: string;
  summary: string;
  status: string;
  kinds: string[];
  tags: string[];
  updatedAt?: string;
  filePath: string;
}>): string[] {
  return nodes.flatMap((node) => [
    `- @${node.id} · ${node.title} · ${node.kinds.join(', ')} · ${node.status}${node.updatedAt ? ` · updated ${node.updatedAt}` : ''}`,
    `  summary: ${node.summary}`,
    `  tags: ${node.tags.join(', ') || 'none'}`,
    `  file: ${node.filePath}`,
  ]);
}

function formatNodePackage(node: {
  id: string;
  title: string;
  summary: string;
  description?: string;
  status: string;
  kinds: string[];
  tags: string[];
  filePath: string;
  body: string;
  updatedAt?: string;
}): string {
  return [
    `Page @${node.id}`,
    `title: ${node.title}`,
    `types: ${node.kinds.join(', ')}`,
    `status: ${node.status}`,
    ...(node.updatedAt ? [`updated: ${node.updatedAt}`] : []),
    `summary: ${node.summary}`,
    ...(node.description ? [`description: ${node.description}`] : []),
    `tags: ${node.tags.join(', ') || 'none'}`,
    `file: ${node.filePath}`,
    '',
    node.body,
  ].join('\n');
}

function details(value: Record<string, unknown>): Record<string, unknown> {
  return value;
}

export function createNodeAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'node',
      label: 'Page',
      description: 'Inspect, search, create, update, and validate unified durable pages.',
      promptSnippet: 'Use this tool for durable page discovery and CRUD instead of shelling out to pa node.',
      promptGuidelines: [
        'Use this tool for durable page discovery and validation instead of running pa node through bash.',
        'Prefer find/show before creating a new page so you do not duplicate durable knowledge.',
        'Use tag or update when you only need to change metadata or body for an existing page.',
      ],
      parameters: NodeToolParams,
      async execute(_toolCallId, params) {
        try {
          switch (params.action as NodeAction) {
            case 'list': {
              const loaded = loadUnifiedNodes();
              const nodes = findUnifiedNodes(loaded.nodes, params.query);
              const lines = nodes.length > 0 ? ['Unified pages:', ...formatNodeSummaryList(nodes)] : ['No unified pages found.'];
              const parseErrorLines = formatParseErrors(loaded.parseErrors);
              if (parseErrorLines.length > 0) lines.push('', ...parseErrorLines);
              return {
                content: [{ type: 'text' as const, text: lines.join('\n') }],
                details: details({
                  action: 'list',
                  nodesDir: loaded.nodesDir,
                  query: params.query?.trim() || null,
                  nodeIds: nodes.map((node) => node.id),
                  parseErrorCount: loaded.parseErrors.length,
                }),
              };
            }
            case 'find': {
              const query = readRequiredString(params.query, 'query');
              const loaded = loadUnifiedNodes();
              const nodes = findUnifiedNodes(loaded.nodes, query);
              const lines = [
                'Unified page search:',
                `query: ${query}`,
                '',
                ...(nodes.length > 0 ? formatNodeSummaryList(nodes) : ['No unified pages matched the supplied query.']),
              ];
              const parseErrorLines = formatParseErrors(loaded.parseErrors);
              if (parseErrorLines.length > 0) lines.push('', ...parseErrorLines);
              return {
                content: [{ type: 'text' as const, text: lines.join('\n') }],
                details: details({
                  action: 'find',
                  nodesDir: loaded.nodesDir,
                  query,
                  nodeIds: nodes.map((node) => node.id),
                  parseErrorCount: loaded.parseErrors.length,
                }),
              };
            }
            case 'show':
            case 'get': {
              const loaded = loadUnifiedNodes();
              const nodeId = readRequiredString(params.nodeId, 'nodeId');
              const node = findUnifiedNodeById(loaded.nodes, nodeId);
              const lines = [formatNodePackage(node)];
              const parseErrorLines = formatParseErrors(loaded.parseErrors);
              if (parseErrorLines.length > 0) lines.push('', ...parseErrorLines);
              return {
                content: [{ type: 'text' as const, text: lines.join('\n') }],
                details: details({
                  action: params.action,
                  nodesDir: loaded.nodesDir,
                  nodeId: node.id,
                  kinds: node.kinds,
                  status: node.status,
                  filePath: node.filePath,
                  updatedAt: node.updatedAt ?? null,
                }),
              };
            }
            case 'new': {
              const result = createUnifiedNode({
                id: readRequiredString(params.nodeId, 'nodeId'),
                title: readRequiredString(params.title, 'title'),
                summary: readRequiredString(params.summary, 'summary'),
                description: params.description?.trim() || undefined,
                status: params.status?.trim() || undefined,
                body: params.body?.trim() || undefined,
                tags: params.tags?.map((value) => value.trim()).filter((value) => value.length > 0),
                parent: params.parent?.trim() || undefined,
                related: params.related?.map((value) => value.trim()).filter((value) => value.length > 0),
                force: params.force,
              });
              return {
                content: [{ type: 'text' as const, text: `${result.overwritten ? 'Updated' : 'Created'} page @${result.node.id}.\nfile: ${result.node.filePath}` }],
                details: details({
                  action: 'new',
                  nodesDir: result.nodesDir,
                  nodeId: result.node.id,
                  filePath: result.node.filePath,
                  overwritten: result.overwritten,
                  kinds: result.node.kinds,
                }),
              };
            }
            case 'update': {
              const node = updateUnifiedNode({
                id: readRequiredString(params.nodeId, 'nodeId'),
                title: params.title,
                summary: params.summary,
                description: params.description === '' ? null : params.description,
                status: params.status,
                body: params.body,
                addTags: params.addTags,
                removeTags: params.removeTags,
                parent: params.parent === '' ? null : params.parent,
                related: params.related,
              });
              return {
                content: [{ type: 'text' as const, text: `Updated page @${node.id}.\nfile: ${node.filePath}` }],
                details: details({
                  action: 'update',
                  nodeId: node.id,
                  filePath: node.filePath,
                  kinds: node.kinds,
                }),
              };
            }
            case 'delete': {
              const result = deleteUnifiedNode(readRequiredString(params.nodeId, 'nodeId'));
              return {
                content: [{ type: 'text' as const, text: `Deleted page @${result.id}.` }],
                details: details(result),
              };
            }
            case 'tag': {
              const node = tagUnifiedNode({
                id: readRequiredString(params.nodeId, 'nodeId'),
                add: params.addTags,
                remove: params.removeTags,
              });
              return {
                content: [{ type: 'text' as const, text: `Updated tags for @${node.id}.\ntags: ${node.tags.join(', ') || 'none'}` }],
                details: details({
                  action: 'tag',
                  nodeId: node.id,
                  tags: node.tags,
                }),
              };
            }
            case 'lint': {
              const result = lintUnifiedNodes();
              const hasIssues = result.parseErrors.length > 0 || result.duplicateIds.length > 0 || result.referenceErrors.length > 0;
              const lines = [
                'Unified page validation',
                `nodesDir: ${result.nodesDir}`,
                `nodesParsed: ${result.validNodes}`,
                `parseErrors: ${result.parseErrors.length}`,
                `duplicateIds: ${result.duplicateIds.length}`,
                `referenceErrors: ${result.referenceErrors.length}`,
              ];
              if (!hasIssues) {
                lines.push('', 'All unified pages are valid.');
              }
              if (result.parseErrors.length > 0) {
                lines.push('', 'Parse errors:');
                for (const issue of result.parseErrors) lines.push(`- ${issue.filePath}: ${issue.error}`);
              }
              if (result.duplicateIds.length > 0) {
                lines.push('', 'Duplicate ids:');
                for (const issue of result.duplicateIds) lines.push(`- ${issue.id}: ${issue.files.join(', ')}`);
              }
              if (result.referenceErrors.length > 0) {
                lines.push('', 'Reference errors:');
                for (const issue of result.referenceErrors) lines.push(`- ${issue.id}.${issue.field} -> ${issue.targetId}: ${issue.error}`);
              }
              return {
                content: [{ type: 'text' as const, text: lines.join('\n') }],
                details: details({
                  action: 'lint',
                  nodesDir: result.nodesDir,
                  validNodes: result.validNodes,
                  parseErrorCount: result.parseErrors.length,
                  duplicateCount: result.duplicateIds.length,
                  referenceErrorCount: result.referenceErrors.length,
                  hasIssues,
                }),
              };
            }
            default:
              throw new Error(`Unsupported page action: ${String(params.action)}`);
          }
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
            isError: true,
            details: details({
              action: params.action,
            }),
          };
        }
      },
    });
  };
}
