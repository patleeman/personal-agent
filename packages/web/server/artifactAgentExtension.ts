import { homedir } from 'node:os';
import { join } from 'node:path';
import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  deleteConversationArtifact,
  getConversationArtifact,
  listConversationArtifacts,
  saveConversationArtifact,
  type ConversationArtifactKind,
} from '@personal-agent/core';
import { invalidateAppTopics } from './appEvents.js';

const ARTIFACT_ACTION_VALUES = ['save', 'get', 'list', 'delete'] as const;
const ARTIFACT_KIND_VALUES = ['html', 'mermaid', 'latex'] as const;
const WHITE_PAPER_REFERENCE_PATH = join(
  homedir(),
  '.local',
  'state',
  'personal-agent',
  'profiles',
  'shared',
  'agent',
  'skills',
  'artifact-output',
  'references',
  'white-paper.md',
);

type ArtifactAction = (typeof ARTIFACT_ACTION_VALUES)[number];

const ArtifactToolParams = Type.Object({
  action: Type.Union(ARTIFACT_ACTION_VALUES.map((value) => Type.Literal(value))),
  artifactId: Type.Optional(Type.String({ description: 'Stable artifact id. Reuse this when updating an existing artifact.' })),
  kind: Type.Optional(Type.Union(ARTIFACT_KIND_VALUES.map((value) => Type.Literal(value)))),
  title: Type.Optional(Type.String({ description: 'Artifact title shown in the chat stub and artifact panel.' })),
  content: Type.Optional(Type.String({ description: 'Artifact source content. HTML should be self-contained. Mermaid should be raw source. LaTeX should be raw source, including full LaTeX documents when needed.' })),
  open: Type.Optional(Type.Boolean({ description: 'Whether the artifact panel should open after saving. Defaults to true.' })),
});

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function readRequiredKind(kind: string | undefined): ConversationArtifactKind {
  const normalized = readRequiredString(kind, 'kind');
  if (!ARTIFACT_KIND_VALUES.includes(normalized as ConversationArtifactKind)) {
    throw new Error(`Invalid artifact kind "${normalized}".`);
  }

  return normalized as ConversationArtifactKind;
}

function formatArtifactList(conversationId: string, artifacts: ReturnType<typeof listConversationArtifacts>): string {
  if (artifacts.length === 0) {
    return `No artifacts saved for conversation ${conversationId}.`;
  }

  return [
    `Artifacts for conversation ${conversationId}:`,
    ...artifacts.map((artifact) => `- ${artifact.id} [${artifact.kind}] ${artifact.title} (rev ${artifact.revision}, updated ${artifact.updatedAt})`),
  ].join('\n');
}

function formatArtifact(record: NonNullable<ReturnType<typeof getConversationArtifact>>): string {
  return [
    `Artifact ${record.id}`,
    `Title: ${record.title}`,
    `Kind: ${record.kind}`,
    `Revision: ${record.revision}`,
    `Updated: ${record.updatedAt}`,
    '',
    record.content,
  ].join('\n');
}

export function createArtifactAgentExtension(options: {
  stateRoot?: string;
  getCurrentProfile: () => string;
}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'artifact',
      label: 'Artifact',
      description: 'Create, update, inspect, and delete rendered conversation artifacts for the web UI.',
      promptSnippet: 'Create or update rendered HTML, Mermaid, and LaTeX artifacts for the artifact panel.',
      promptGuidelines: [
        'Use this tool when the user asks for a rendered artifact in the web UI, or when rendering would explain an idea more clearly than plain chat (for example, Mermaid diagrams or HTML mockups).',
        'Use kind=html for self-contained interactive artifacts, kind=mermaid for diagrams, and kind=latex for raw LaTeX source, including full document-style reports when appropriate.',
        `For report-style HTML artifacts, read and adapt the shared artifact-output white-paper reference at ${WHITE_PAPER_REFERENCE_PATH}.`,
        'Default white-paper/report HTML to a self-contained LaTeX.css-style single-column reading layout with calm typography; think internal memo or technical report, not dashboard or landing page chrome.',
        'Reuse the same artifactId when iterating on an existing artifact so the chat stub and artifact panel stay linked.',
        'Keep HTML self-contained; do not rely on external network resources unless the user explicitly asks for that tradeoff.',
      ],
      parameters: ArtifactToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        try {
          const profile = options.getCurrentProfile();
          const conversationId = ctx.sessionManager.getSessionId();

          switch (params.action as ArtifactAction) {
            case 'save': {
              const record = saveConversationArtifact({
                stateRoot: options.stateRoot,
                profile,
                conversationId,
                ...(params.artifactId !== undefined ? { artifactId: params.artifactId } : {}),
                title: readRequiredString(params.title, 'title'),
                kind: readRequiredKind(params.kind),
                content: params.content ?? '',
              });
              const openRequested = params.open ?? true;

              invalidateAppTopics('sessions');
              return {
                content: [{
                  type: 'text' as const,
                  text: `${record.revision === 1 ? 'Saved' : 'Updated'} artifact ${record.id} [${record.kind}] "${record.title}".`,
                }],
                details: {
                  action: 'save',
                  conversationId,
                  artifactId: record.id,
                  title: record.title,
                  kind: record.kind,
                  revision: record.revision,
                  updatedAt: record.updatedAt,
                  openRequested,
                },
              };
            }

            case 'get': {
              const artifactId = readRequiredString(params.artifactId, 'artifactId');
              const record = getConversationArtifact({
                stateRoot: options.stateRoot,
                profile,
                conversationId,
                artifactId,
              });
              if (!record) {
                throw new Error(`Artifact ${artifactId} was not found.`);
              }

              return {
                content: [{ type: 'text' as const, text: formatArtifact(record) }],
                details: {
                  action: 'get',
                  conversationId,
                  artifactId: record.id,
                  title: record.title,
                  kind: record.kind,
                  revision: record.revision,
                  updatedAt: record.updatedAt,
                },
              };
            }

            case 'list': {
              const artifacts = listConversationArtifacts({
                stateRoot: options.stateRoot,
                profile,
                conversationId,
              });

              return {
                content: [{ type: 'text' as const, text: formatArtifactList(conversationId, artifacts) }],
                details: {
                  action: 'list',
                  conversationId,
                  artifactCount: artifacts.length,
                  artifactIds: artifacts.map((artifact) => artifact.id),
                },
              };
            }

            case 'delete': {
              const artifactId = readRequiredString(params.artifactId, 'artifactId');
              const removed = deleteConversationArtifact({
                stateRoot: options.stateRoot,
                profile,
                conversationId,
                artifactId,
              });

              invalidateAppTopics('sessions');
              return {
                content: [{
                  type: 'text' as const,
                  text: removed
                    ? `Deleted artifact ${artifactId}.`
                    : `Artifact ${artifactId} did not exist.`,
                }],
                details: {
                  action: 'delete',
                  conversationId,
                  artifactId,
                  deleted: removed,
                },
              };
            }

            default:
              throw new Error(`Unsupported artifact action: ${String(params.action)}`);
          }
        } catch (error) {
          throw error instanceof Error ? error : new Error(String(error));
        }
      },
    });
  };
}
