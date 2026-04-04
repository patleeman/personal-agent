import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  createProjectActivityEntry,
  getDurableSessionsDir,
  setConversationProjectLinks,
  writeProfileActivityEntry,
} from '@personal-agent/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSessionCaches } from '../conversations/sessions.js';
import {
  addProjectMilestone,
  createProjectRecord,
  createProjectTaskRecord,
} from './projects.js';
import {
  saveProjectDocument,
  uploadProjectFile,
} from './projectResources.js';
import {
  buildProjectSharePackageFileName,
  exportProjectSharePackage,
  PROJECT_SHARE_PACKAGE_KIND,
  PROJECT_SHARE_PACKAGE_VERSION,
} from './projectPackages.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function sessionIndexPathFor(sessionsDir: string): string {
  return join(dirname(sessionsDir), `${basename(sessionsDir)}-session-meta-index.json`);
}

function configureRuntimeEnv(rootDir: string): { repoRoot: string; stateRoot: string; sessionsDir: string } {
  const repoRoot = join(rootDir, 'repo');
  const stateRoot = join(rootDir, 'state');
  const sessionsDir = getDurableSessionsDir(stateRoot);

  process.env.PERSONAL_AGENT_PROFILES_ROOT = join(stateRoot, 'sync', 'profiles');
  process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
  process.env.PERSONAL_AGENT_VAULT_ROOT = join(stateRoot, 'sync');
  process.env.PA_SESSIONS_DIR = sessionsDir;
  process.env.PA_SESSIONS_INDEX_FILE = sessionIndexPathFor(sessionsDir);

  return { repoRoot, stateRoot, sessionsDir };
}

function writeSessionFile(options: {
  sessionsDir: string;
  conversationId: string;
  cwdSlug?: string;
  timestamp?: string;
  title?: string;
  assistantText?: string;
  sessionName?: string;
}): string {
  const cwdSlug = options.cwdSlug ?? '--tmp-project--';
  const dir = join(options.sessionsDir, cwdSlug);
  mkdirSync(dir, { recursive: true });

  const timestamp = options.timestamp ?? '2026-03-16T15:00:00.000Z';
  const title = options.title ?? 'Summarize the project for handoff';
  const assistantText = options.assistantText ?? 'Here is the current project state.';
  const filePath = join(dir, `2026-03-16T15-00-00-000Z_${options.conversationId}.jsonl`);

  const lines = [
    JSON.stringify({ type: 'session', id: options.conversationId, timestamp, cwd: '/Users/patrick/work/project' }),
    JSON.stringify({ type: 'model_change', modelId: 'gpt-5.1-codex-mini' }),
    JSON.stringify({
      type: 'message',
      id: `${options.conversationId}-user-1`,
      parentId: null,
      timestamp,
      message: { role: 'user', content: title },
    }),
    JSON.stringify({
      type: 'message',
      id: `${options.conversationId}-assistant-1`,
      parentId: `${options.conversationId}-user-1`,
      timestamp: '2026-03-16T15:00:05.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: assistantText }],
      },
    }),
    ...(options.sessionName
      ? [JSON.stringify({
        type: 'session_info',
        id: `${options.conversationId}-session-info`,
        parentId: `${options.conversationId}-assistant-1`,
        timestamp: '2026-03-16T15:00:59.000Z',
        name: options.sessionName,
      })]
      : []),
  ];

  writeFileSync(filePath, `${lines.join('\n')}\n`);
  return filePath;
}

beforeEach(() => {
  process.env = { ...originalEnv };
  clearSessionCaches();
});

afterEach(async () => {
  process.env = originalEnv;
  clearSessionCaches();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('project share packages', () => {
  it.skip('exports a single JSON package with project state, files, activity, and linked conversations', () => {
    const rootDir = createTempDir('pa-project-package-');
    const { repoRoot, sessionsDir } = configureRuntimeEnv(rootDir);

    createProjectRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'shareable-work',
      title: 'Shareable work',
      description: 'Package this project for handoff.',
      projectRepoRoot: '../workspace/shareable-work',
      summary: 'Ready to hand off.',
      goal: 'Create a portable project package.',
      acceptanceCriteria: ['Export includes the project plan.', 'Export includes linked conversations.'],
      status: 'in_progress',
      currentFocus: 'Ship the export flow.',
      blockers: ['Need a portable package format'],
      recentProgress: ['Defined the package schema'],
    });

    addProjectMilestone({
      repoRoot,
      profile: 'datadog',
      projectId: 'shareable-work',
      id: 'handoff',
      title: 'Prepare handoff',
      status: 'in_progress',
      makeCurrent: true,
    });

    createProjectTaskRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'shareable-work',
      taskId: 'export-package',
      title: 'Export the project package',
      status: 'in_progress',
      milestoneId: 'handoff',
    });

    saveProjectDocument({
      repoRoot,
      profile: 'datadog',
      projectId: 'shareable-work',
      content: '# Shareable work\n\n## Requirements\n\nPortable handoff package.\n',
    });

    uploadProjectFile({
      repoRoot,
      profile: 'datadog',
      projectId: 'shareable-work',
      kind: 'attachment',
      name: 'handoff-notes.txt',
      mimeType: 'text/plain',
      title: 'Handoff notes',
      description: 'Notes to include in the package.',
      data: Buffer.from('plain attachment body').toString('base64'),
    });

    uploadProjectFile({
      repoRoot,
      profile: 'datadog',
      projectId: 'shareable-work',
      kind: 'artifact',
      name: 'handoff.md',
      mimeType: 'text/markdown',
      title: 'Handoff artifact',
      description: 'Generated output to share.',
      data: Buffer.from('# exported artifact').toString('base64'),
    });

    writeSessionFile({
      sessionsDir,
      conversationId: 'conv-123',
      sessionName: 'Packaging conversation',
      assistantText: 'The project package should include all linked conversations.',
    });

    setConversationProjectLinks({
      profile: 'datadog',
      conversationId: 'conv-123',
      relatedProjectIds: ['shareable-work'],
      updatedAt: '2026-03-16T15:01:00.000Z',
    });

    setConversationProjectLinks({
      profile: 'datadog',
      conversationId: 'conv-missing',
      relatedProjectIds: ['shareable-work'],
      updatedAt: '2026-03-16T15:02:00.000Z',
    });

    writeProfileActivityEntry({
      profile: 'datadog',
      entry: createProjectActivityEntry({
        id: 'share-package-ready',
        createdAt: '2026-03-16T15:03:00.000Z',
        profile: 'datadog',
        kind: 'follow-up',
        summary: 'Project package is ready to share.',
        details: 'Send the exported file to reviewers.',
        relatedProjectIds: ['shareable-work'],
      }),
    });

    clearSessionCaches();

    const pkg = exportProjectSharePackage({
      repoRoot,
      profile: 'datadog',
      projectId: 'shareable-work',
      exportedAt: '2026-03-16T16:00:00.000Z',
    });

    expect(pkg.kind).toBe(PROJECT_SHARE_PACKAGE_KIND);
    expect(pkg.version).toBe(PROJECT_SHARE_PACKAGE_VERSION);
    expect(pkg.source).toEqual({ profile: 'datadog', projectId: 'shareable-work' });
    expect(pkg.project.id).toBe('shareable-work');
    expect(pkg.project.plan.milestones[0]?.id).toBe('handoff');
    expect(pkg.project.plan.tasks[0]?.id).toBe('export-package');
    expect('repoRoot' in pkg.project).toBe(false);

    expect(pkg.document?.content).toContain('Portable handoff package');

    expect(pkg.attachments).toEqual([
      expect.objectContaining({
        title: 'Handoff notes',
        encoding: 'base64',
      }),
    ]);
    expect(Buffer.from(pkg.attachments[0]!.content, 'base64').toString('utf-8')).toBe('plain attachment body');
    expect('path' in pkg.attachments[0]!).toBe(false);
    expect('downloadPath' in pkg.attachments[0]!).toBe(false);

    expect(pkg.artifacts).toEqual([
      expect.objectContaining({
        title: 'Handoff artifact',
        encoding: 'base64',
      }),
    ]);
    expect(Buffer.from(pkg.artifacts[0]!.content, 'base64').toString('utf-8')).toBe('# exported artifact');

    expect(pkg.activity).toEqual([
      expect.objectContaining({
        id: 'share-package-ready',
        summary: 'Project package is ready to share.',
      }),
    ]);

    const includedConversation = pkg.conversations.find((conversation) => conversation.conversationId === 'conv-123');
    expect(includedConversation).toEqual(expect.objectContaining({
      title: 'Packaging conversation',
      status: 'included',
      transcriptFormat: 'pi-session-jsonl',
      messageCount: 2,
      model: 'gpt-5.1-codex-mini',
    }));
    expect(includedConversation?.transcript).toContain('The project package should include all linked conversations.');
    expect(includedConversation?.summary).toContain('Summarize the project for handoff');
    expect('cwd' in (includedConversation ?? {})).toBe(false);

    const missingConversation = pkg.conversations.find((conversation) => conversation.conversationId === 'conv-missing');
    expect(missingConversation).toEqual({
      conversationId: 'conv-missing',
      title: 'conv-missing',
      linkUpdatedAt: '2026-03-16T15:02:00.000Z',
      status: 'missing',
    });
  });

  it('builds a stable download filename for exported packages', () => {
    expect(buildProjectSharePackageFileName({
      projectId: 'shareable-work',
      exportedAt: '2026-03-16T16:00:00.000Z',
    })).toBe('shareable-work-2026-03-16T16-00-00-000Z.pa-project.json');
  });
});
