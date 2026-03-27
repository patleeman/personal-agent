import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectScaffold, resolveProjectPaths } from '@personal-agent/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProjectNoteRecord,
  deleteProjectFileRecord,
  deleteProjectNoteRecord,
  listProjectFiles,
  listProjectNotes,
  readProjectBrief,
  readProjectFileDownload,
  saveProjectBrief,
  updateProjectNoteRecord,
  uploadProjectFile,
} from './projectResources.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-project-resources-'));
  tempDirs.push(dir);
  process.env.PERSONAL_AGENT_STATE_ROOT = dir;
  process.env.PERSONAL_AGENT_PROFILES_ROOT = join(dir, 'sync', 'profiles');
  return dir;
}

describe('projectResources', () => {
  it('writes and reads a canonical project document', () => {
    const repoRoot = createTempRepo();
    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'briefs',
      title: 'Briefs',
      description: 'Test project docs',
    });

    saveProjectBrief({
      repoRoot,
      profile: 'datadog',
      projectId: 'briefs',
      content: '# Project doc\n\nA durable project note.',
    });

    const brief = readProjectBrief({ repoRoot, profile: 'datadog', projectId: 'briefs' });
    expect(brief?.content).toContain('A durable project note.');
    expect(brief?.path).toContain('INDEX.md');
  });

  it('creates, updates, lists, and deletes project notes', () => {
    const repoRoot = createTempRepo();
    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'notes',
      title: 'Notes',
      description: 'Test project notes',
    });

    const created = createProjectNoteRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'notes',
      title: 'Capture the decision',
      kind: 'decision',
      body: 'Keep the main project doc in INDEX.md.',
    });

    const updated = updateProjectNoteRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'notes',
      noteId: created.id,
      body: 'Keep the main project doc in INDEX.md and regenerate it on demand.',
    });

    expect(updated.body).toContain('regenerate it on demand');
    expect(listProjectNotes({ repoRoot, profile: 'datadog', projectId: 'notes' })).toHaveLength(1);

    deleteProjectNoteRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'notes',
      noteId: created.id,
    });

    expect(listProjectNotes({ repoRoot, profile: 'datadog', projectId: 'notes' })).toHaveLength(0);
  });

  it('uploads, downloads, and deletes project files from the unified files bucket', () => {
    const repoRoot = createTempRepo();
    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'files',
      title: 'Files',
      description: 'Test project files',
    });

    const file = uploadProjectFile({
      repoRoot,
      profile: 'datadog',
      projectId: 'files',
      name: 'notes.txt',
      mimeType: 'text/plain',
      title: 'Meeting notes',
      description: 'Captured from the kickoff meeting.',
      data: Buffer.from('hello world').toString('base64'),
    });

    expect(file.downloadPath).toContain('/api/projects/files/files/');
    expect(listProjectFiles({ repoRoot, profile: 'datadog', projectId: 'files' })).toHaveLength(1);

    const download = readProjectFileDownload({
      repoRoot,
      profile: 'datadog',
      projectId: 'files',
      fileId: file.id,
    });
    expect(readFileSync(download.filePath, 'utf-8')).toBe('hello world');

    deleteProjectFileRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'files',
      fileId: file.id,
    });

    const paths = resolveProjectPaths({ repoRoot, profile: 'datadog', projectId: 'files' });
    expect(existsSync(paths.filesDir)).toBe(true);
    expect(listProjectFiles({ repoRoot, profile: 'datadog', projectId: 'files' })).toHaveLength(0);
  });
});
