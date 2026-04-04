import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectScaffold, resolveProjectPaths } from '@personal-agent/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteProjectFileRecord,
  listProjectFiles,
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
  process.env.PERSONAL_AGENT_VAULT_ROOT = join(dir, 'sync');
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
    expect(brief?.path).toContain('project.md');
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
