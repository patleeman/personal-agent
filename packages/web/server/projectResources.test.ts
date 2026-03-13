import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectScaffold, resolveProjectPaths } from '@personal-agent/core';
import { afterEach, describe, expect, it } from 'vitest';
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

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-project-resources-'));
  tempDirs.push(dir);
  return dir;
}

describe('projectResources', () => {
  it('writes and reads a canonical project brief', () => {
    const repoRoot = createTempRepo();
    createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'briefs',
      title: 'Briefs',
      description: 'Test project briefs',
    });

    saveProjectBrief({
      repoRoot,
      profile: 'datadog',
      projectId: 'briefs',
      content: '# Project brief\n\nA durable brief.',
    });

    const brief = readProjectBrief({ repoRoot, profile: 'datadog', projectId: 'briefs' });
    expect(brief?.content).toContain('A durable brief.');
    expect(brief?.path).toContain('BRIEF.md');
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
      body: 'Keep project briefs in BRIEF.md.',
    });

    const updated = updateProjectNoteRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'notes',
      noteId: created.id,
      body: 'Keep project briefs in BRIEF.md and regenerate them on demand.',
    });

    expect(updated.body).toContain('regenerate them on demand');
    expect(listProjectNotes({ repoRoot, profile: 'datadog', projectId: 'notes' })).toHaveLength(1);

    deleteProjectNoteRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'notes',
      noteId: created.id,
    });

    expect(listProjectNotes({ repoRoot, profile: 'datadog', projectId: 'notes' })).toHaveLength(0);
  });

  it('uploads, downloads, and deletes project files', () => {
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
      kind: 'attachment',
      name: 'notes.txt',
      mimeType: 'text/plain',
      title: 'Meeting notes',
      description: 'Captured from the kickoff meeting.',
      data: Buffer.from('hello world').toString('base64'),
    });

    expect(file.downloadPath).toContain('/api/projects/files/files/attachment/');
    expect(listProjectFiles({ repoRoot, profile: 'datadog', projectId: 'files', kind: 'attachment' })).toHaveLength(1);

    const download = readProjectFileDownload({
      repoRoot,
      profile: 'datadog',
      projectId: 'files',
      kind: 'attachment',
      fileId: file.id,
    });
    expect(readFileSync(download.filePath, 'utf-8')).toBe('hello world');

    deleteProjectFileRecord({
      repoRoot,
      profile: 'datadog',
      projectId: 'files',
      kind: 'attachment',
      fileId: file.id,
    });

    const paths = resolveProjectPaths({ repoRoot, profile: 'datadog', projectId: 'files' });
    expect(existsSync(paths.attachmentsDir)).toBe(true);
    expect(listProjectFiles({ repoRoot, profile: 'datadog', projectId: 'files', kind: 'attachment' })).toHaveLength(0);
  });
});
