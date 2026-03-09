import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ensureConversationMaintenanceIndexPath,
  getConversationMaintenanceIndexPath,
  getDefaultStateRoot,
  getStateRoot,
} from './paths.mjs';

const originalPersonalAgentStateRoot = process.env.PERSONAL_AGENT_STATE_ROOT;
const originalXdgStateHome = process.env.XDG_STATE_HOME;
const tempDirs = [];

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-maintenance-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  if (originalPersonalAgentStateRoot === undefined) {
    delete process.env.PERSONAL_AGENT_STATE_ROOT;
  } else {
    process.env.PERSONAL_AGENT_STATE_ROOT = originalPersonalAgentStateRoot;
  }

  if (originalXdgStateHome === undefined) {
    delete process.env.XDG_STATE_HOME;
  } else {
    process.env.XDG_STATE_HOME = originalXdgStateHome;
  }

  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('conversation-maintenance runtime paths', () => {
  it('uses PERSONAL_AGENT_STATE_ROOT when set', () => {
    delete process.env.XDG_STATE_HOME;
    process.env.PERSONAL_AGENT_STATE_ROOT = 'relative-state-root';

    expect(getStateRoot()).toBe(path.resolve('relative-state-root'));
    expect(getConversationMaintenanceIndexPath('assistant')).toBe(
      path.resolve('relative-state-root', 'conversation-maintenance', 'assistant', 'processed-conversations.json'),
    );
  });

  it('falls back to XDG_STATE_HOME when PERSONAL_AGENT_STATE_ROOT is unset', () => {
    delete process.env.PERSONAL_AGENT_STATE_ROOT;
    process.env.XDG_STATE_HOME = '/tmp/personal-agent-xdg';

    expect(getDefaultStateRoot()).toBe(path.resolve('/tmp/personal-agent-xdg', 'personal-agent'));
    expect(getStateRoot()).toBe(path.resolve('/tmp/personal-agent-xdg', 'personal-agent'));
  });

  it('migrates the legacy repo index into runtime state', async () => {
    const tempDir = await createTempDir();
    const repoRoot = path.join(tempDir, 'repo');
    const stateRoot = path.join(tempDir, 'state-root');
    const legacyPath = path.join(
      repoRoot,
      'profiles',
      'assistant',
      'agent',
      'state',
      'conversation-maintenance',
      'processed-conversations.json',
    );

    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    delete process.env.XDG_STATE_HOME;

    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, '{"version":1}\n', 'utf8');

    const result = await ensureConversationMaintenanceIndexPath('assistant', repoRoot);

    expect(result).toEqual({
      indexPath: path.join(
        stateRoot,
        'conversation-maintenance',
        'assistant',
        'processed-conversations.json',
      ),
      migratedFrom: legacyPath,
    });
    await expect(fs.readFile(result.indexPath, 'utf8')).resolves.toBe('{"version":1}\n');
    await expect(fs.access(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the runtime index when it already exists', async () => {
    const tempDir = await createTempDir();
    const repoRoot = path.join(tempDir, 'repo');
    const stateRoot = path.join(tempDir, 'state-root');
    const runtimePath = path.join(
      stateRoot,
      'conversation-maintenance',
      'assistant',
      'processed-conversations.json',
    );
    const legacyPath = path.join(
      repoRoot,
      'profiles',
      'assistant',
      'agent',
      'state',
      'conversation-maintenance',
      'processed-conversations.json',
    );

    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    delete process.env.XDG_STATE_HOME;

    await fs.mkdir(path.dirname(runtimePath), { recursive: true });
    await fs.writeFile(runtimePath, '{"version":2}\n', 'utf8');
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, '{"version":1}\n', 'utf8');

    const result = await ensureConversationMaintenanceIndexPath('assistant', repoRoot);

    expect(result).toEqual({
      indexPath: runtimePath,
      migratedFrom: null,
    });
    await expect(fs.readFile(runtimePath, 'utf8')).resolves.toBe('{"version":2}\n');
    await expect(fs.readFile(legacyPath, 'utf8')).resolves.toBe('{"version":1}\n');
  });
});
