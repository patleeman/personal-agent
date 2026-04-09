import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getActivityConversationLink, listProfileActivityEntries, loadProfileActivityReadState } from '@personal-agent/core';
import { createActivityAgentExtension } from './activityAgentExtension.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function registerActivityTool(stateRoot: string) {
  let registeredTool:
    | { execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }> }> }
    | undefined;

  createActivityAgentExtension({
    stateRoot,
    getCurrentProfile: () => 'datadog',
  })({
    registerTool: (tool: unknown) => {
      registeredTool = tool as { execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }> }> };
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Activity tool was not registered.');
  }

  return registeredTool;
}

describe('activity agent extension', () => {
  it('creates and lists durable activity items', async () => {
    const stateRoot = createTempDir('pa-web-activity-tool-');
    const activityTool = registerActivityTool(stateRoot);

    const created = await activityTool.execute('tool-1', {
      action: 'create',
      summary: 'Check the daemon logs later',
      kind: 'reminder',
      relatedProjectIds: ['web-ui'],
      relatedConversationIds: ['conv-123'],
    });

    expect(created.isError).not.toBe(true);
    expect(created.content[0]?.text).toContain('Created activity');

    const entries = listProfileActivityEntries({ stateRoot, profile: 'datadog' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry.summary).toBe('Check the daemon logs later');
    expect(getActivityConversationLink({ stateRoot, profile: 'datadog', activityId: entries[0]!.entry.id })?.relatedConversationIds).toEqual(['conv-123']);

    const listed = await activityTool.execute('tool-2', { action: 'list' });
    expect(listed.content[0]?.text).toContain('Check the daemon logs later');
    expect(listed.content[0]?.text).toContain('[unread]');
  });

  it('marks activity items read and unread', async () => {
    const stateRoot = createTempDir('pa-web-activity-tool-');
    const activityTool = registerActivityTool(stateRoot);

    await activityTool.execute('tool-1', {
      action: 'create',
      activityId: 'daily-review',
      summary: 'Review the daily summary',
    });

    let readState = loadProfileActivityReadState({ stateRoot, profile: 'datadog' });
    expect(readState.has('daily-review')).toBe(false);

    const markRead = await activityTool.execute('tool-2', {
      action: 'mark_read',
      activityId: 'daily-review',
    });
    expect(markRead.isError).not.toBe(true);

    readState = loadProfileActivityReadState({ stateRoot, profile: 'datadog' });
    expect(readState.has('daily-review')).toBe(true);

    const markUnread = await activityTool.execute('tool-3', {
      action: 'mark_unread',
      activityId: 'daily-review',
    });
    expect(markUnread.isError).not.toBe(true);

    readState = loadProfileActivityReadState({ stateRoot, profile: 'datadog' });
    expect(readState.has('daily-review')).toBe(false);
  });

  it('gets detailed activity entries and deletes bulk selections', async () => {
    const stateRoot = createTempDir('pa-web-activity-tool-');
    const activityTool = registerActivityTool(stateRoot);

    await activityTool.execute('tool-1', {
      action: 'create',
      activityId: 'daemon-follow-up',
      summary: 'Check the daemon logs later',
      details: 'Tail the log after the deploy finishes.',
      kind: 'reminder',
      relatedProjectIds: ['web-ui'],
      relatedConversationIds: ['conv-123'],
      notificationState: 'queued',
    });
    await activityTool.execute('tool-2', {
      action: 'create',
      activityId: 'daily-review',
      summary: 'Review today\'s inbox.',
    });
    await activityTool.execute('tool-3', {
      action: 'mark_read',
      activityId: 'daemon-follow-up',
    });

    const fetched = await activityTool.execute('tool-4', {
      action: 'get',
      activityId: 'daemon-follow-up',
    });
    expect(fetched.isError).not.toBe(true);
    expect(fetched.content[0]?.text).toContain('@daemon-follow-up');
    expect(fetched.content[0]?.text).toContain('read: yes');
    expect(fetched.content[0]?.text).toContain('details: Tail the log after the deploy finishes.');
    expect(fetched.content[0]?.text).toContain('projects: web-ui');
    expect(fetched.content[0]?.text).toContain('conversations: conv-123');
    expect(fetched.content[0]?.text).toContain('notification: queued');

    const deleted = await activityTool.execute('tool-5', {
      action: 'delete',
      activityId: 'daemon-follow-up',
      activityIds: ['daily-review', 'daemon-follow-up'],
    });
    expect(deleted.isError).not.toBe(true);
    expect(deleted.content[0]?.text).toBe('Deleted activity items: @daemon-follow-up, @daily-review');
    expect(listProfileActivityEntries({ stateRoot, profile: 'datadog' })).toHaveLength(0);
    expect(getActivityConversationLink({ stateRoot, profile: 'datadog', activityId: 'daemon-follow-up' })).toBeNull();
    expect(loadProfileActivityReadState({ stateRoot, profile: 'datadog' }).size).toBe(0);
  });

  it('allocates unique activity ids and surfaces validation failures as tool errors', async () => {
    const stateRoot = createTempDir('pa-web-activity-tool-');
    const activityTool = registerActivityTool(stateRoot);

    const created = await activityTool.execute('tool-1', {
      action: 'create',
      activityId: 'daily-review',
      summary: 'Review the daily summary',
    });
    expect(created.content[0]?.text).toBe('Created activity @daily-review.');

    const createdAgain = await activityTool.execute('tool-2', {
      action: 'create',
      activityId: 'daily-review',
      summary: 'Review the daily summary again',
    });
    expect(createdAgain.isError).not.toBe(true);
    expect(createdAgain.content[0]?.text).toBe('Created activity @daily-review-2.');

    const failed = await activityTool.execute('tool-3', {
      action: 'mark_read',
      activityIds: ['   '],
    });
    expect(failed.isError).toBe(true);
    expect(failed.content[0]?.text).toBe('activityId or activityIds is required.');
  });
});
