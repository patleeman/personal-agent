import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectScaffold, loadUnifiedNodes, resolveProjectPaths } from '@personal-agent/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteProjectFileRecord,
  listProjectFiles,
  migrateLegacyProjectPages,
  readProjectDocument,
  readProjectFileDownload,
  saveProjectDocument,
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

    saveProjectDocument({
      repoRoot,
      profile: 'datadog',
      projectId: 'briefs',
      content: '# Project doc\n\nA durable project note.',
    });

    const brief = readProjectDocument({ repoRoot, profile: 'datadog', projectId: 'briefs' });
    expect(brief?.content).toContain('A durable project note.');
    expect(brief?.path).toContain('project-document.md');
  });

  it('migrates legacy project notes into child pages', () => {
    const repoRoot = createTempRepo();
    const scaffold = createProjectScaffold({
      repoRoot,
      profile: 'datadog',
      projectId: 'notes',
      title: 'Notes',
      description: 'Test project pages',
    });
    const legacyNotesDir = join(scaffold.paths.projectDir, 'notes');
    mkdirSync(legacyNotesDir, { recursive: true });
    writeFileSync(join(legacyNotesDir, 'capture-the-decision.md'), `---
id: capture-the-decision
title: Capture the decision
kind: decision
createdAt: 2026-03-20T12:00:00.000Z
updatedAt: 2026-03-21T09:30:00.000Z
---
Keep the main project doc in INDEX.md.
`);

    const result = migrateLegacyProjectPages({
      repoRoot,
      profile: 'datadog',
      projectId: 'notes',
    });

    expect(result.migratedPageIds).toHaveLength(1);
    expect(existsSync(legacyNotesDir)).toBe(false);

    const loaded = loadUnifiedNodes();
    const child = loaded.nodes.find((node) => node.id === result.migratedPageIds[0]);
    expect(child?.links.parent).toBe('notes');
    expect(child?.tags).toContain('type:note');
    expect(child?.tags).toContain('profile:datadog');
    expect(child?.tags).toContain('noteType:decision');
    expect(child?.body).toContain('# Capture the decision');
    expect(child?.body).toContain('Keep the main project doc in INDEX.md.');
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
