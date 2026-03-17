import { readFileSync } from 'node:fs';
import {
  listConversationProjectLinks,
  listProfileActivityEntries,
  type ProjectActivityEntryDocument,
  type ProjectDocument,
} from '@personal-agent/core';
import { readProjectDetailFromProject } from './projects.js';
import { listSessions, readSessionSearchText } from './sessions.js';

export const PROJECT_SHARE_PACKAGE_KIND = 'personal-agent.project-package';
export const PROJECT_SHARE_PACKAGE_VERSION = 1;
const PROJECT_SHARE_PACKAGE_TRANSCRIPT_FORMAT = 'pi-session-jsonl';

export type ProjectSharePackageProject = Omit<ProjectDocument, 'repoRoot'>;

export interface ProjectSharePackageBrief {
  updatedAt: string;
  content: string;
}

export interface ProjectSharePackageNote {
  id: string;
  title: string;
  kind: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSharePackageFile {
  id: string;
  kind: 'attachment' | 'artifact';
  title: string;
  description?: string;
  originalName: string;
  mimeType?: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  encoding: 'base64';
  content: string;
}

export interface ProjectSharePackageActivity {
  id: string;
  createdAt: string;
  kind: string;
  summary: string;
  details?: string;
  notificationState?: string;
}

export interface ProjectSharePackageConversation {
  conversationId: string;
  title: string;
  linkUpdatedAt: string;
  status: 'included' | 'missing';
  startedAt?: string;
  lastActivityAt?: string;
  messageCount?: number;
  model?: string;
  isRunning?: boolean;
  summary?: string;
  transcriptFormat?: typeof PROJECT_SHARE_PACKAGE_TRANSCRIPT_FORMAT;
  transcript?: string;
}

export interface ProjectSharePackageDocument {
  kind: typeof PROJECT_SHARE_PACKAGE_KIND;
  version: typeof PROJECT_SHARE_PACKAGE_VERSION;
  exportedAt: string;
  source: {
    profile: string;
    projectId: string;
  };
  project: ProjectSharePackageProject;
  brief: ProjectSharePackageBrief | null;
  notes: ProjectSharePackageNote[];
  attachments: ProjectSharePackageFile[];
  artifacts: ProjectSharePackageFile[];
  conversations: ProjectSharePackageConversation[];
  activity: ProjectSharePackageActivity[];
}

function stripProjectRepoRoot(project: ProjectDocument): ProjectSharePackageProject {
  const { repoRoot: _repoRoot, ...portableProject } = project;
  return portableProject;
}

function serializeFile(record: {
  id: string;
  kind: 'attachment' | 'artifact';
  path: string;
  title: string;
  description?: string;
  originalName: string;
  mimeType?: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}): ProjectSharePackageFile {
  return {
    id: record.id,
    kind: record.kind,
    title: record.title,
    description: record.description,
    originalName: record.originalName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    encoding: 'base64',
    content: readFileSync(record.path).toString('base64'),
  };
}

function serializeActivity(entry: ProjectActivityEntryDocument): ProjectSharePackageActivity {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    kind: entry.kind,
    summary: entry.summary,
    ...(entry.details ? { details: entry.details } : {}),
    ...(entry.notificationState ? { notificationState: entry.notificationState } : {}),
  };
}

function buildConversationPackage(options: {
  profile: string;
  projectId: string;
}): ProjectSharePackageConversation[] {
  const conversationLinks = listConversationProjectLinks({ profile: options.profile })
    .filter((document) => document.relatedProjectIds.includes(options.projectId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const sessionById = new Map(listSessions().map((session) => [session.id, session]));

  return conversationLinks.map((document) => {
    const session = sessionById.get(document.conversationId);

    if (!session) {
      return {
        conversationId: document.conversationId,
        title: document.conversationId,
        linkUpdatedAt: document.updatedAt,
        status: 'missing',
      } satisfies ProjectSharePackageConversation;
    }

    const summary = readSessionSearchText(session.id, 6_000) ?? undefined;

    return {
      conversationId: session.id,
      title: session.title,
      linkUpdatedAt: document.updatedAt,
      status: 'included',
      startedAt: session.timestamp,
      lastActivityAt: session.lastActivityAt,
      messageCount: session.messageCount,
      model: session.model,
      isRunning: Boolean(session.isRunning),
      ...(summary ? { summary } : {}),
      transcriptFormat: PROJECT_SHARE_PACKAGE_TRANSCRIPT_FORMAT,
      transcript: readFileSync(session.file, 'utf-8'),
    } satisfies ProjectSharePackageConversation;
  });
}

function buildActivityPackage(options: {
  profile: string;
  projectId: string;
}): ProjectSharePackageActivity[] {
  return listProfileActivityEntries({ profile: options.profile })
    .map(({ entry }) => entry)
    .filter((entry) => (entry.relatedProjectIds ?? []).includes(options.projectId))
    .map(serializeActivity);
}

export function exportProjectSharePackage(input: {
  repoRoot?: string;
  profile: string;
  projectId: string;
  exportedAt?: string;
}): ProjectSharePackageDocument {
  const detail = readProjectDetailFromProject({
    repoRoot: input.repoRoot,
    profile: input.profile,
    projectId: input.projectId,
  });
  const exportedAt = input.exportedAt ?? new Date().toISOString();

  return {
    kind: PROJECT_SHARE_PACKAGE_KIND,
    version: PROJECT_SHARE_PACKAGE_VERSION,
    exportedAt,
    source: {
      profile: input.profile,
      projectId: input.projectId,
    },
    project: stripProjectRepoRoot(detail.project),
    brief: detail.brief
      ? {
        updatedAt: detail.brief.updatedAt,
        content: detail.brief.content,
      }
      : null,
    notes: detail.notes.map((note) => ({
      id: note.id,
      title: note.title,
      kind: note.kind,
      body: note.body,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    })),
    attachments: detail.attachments.map(serializeFile),
    artifacts: detail.artifacts.map(serializeFile),
    conversations: buildConversationPackage({
      profile: input.profile,
      projectId: input.projectId,
    }),
    activity: buildActivityPackage({
      profile: input.profile,
      projectId: input.projectId,
    }),
  };
}

function slugifyTimestamp(value: string): string {
  return value.replace(/[:.]/g, '-');
}

export function buildProjectSharePackageFileName(input: {
  projectId: string;
  exportedAt: string;
}): string {
  return `${input.projectId}-${slugifyTimestamp(input.exportedAt)}.pa-project.json`;
}
