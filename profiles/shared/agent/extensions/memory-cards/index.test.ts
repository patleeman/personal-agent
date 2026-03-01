import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import memoryCardsExtension from './index';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
  delete process.env.PERSONAL_AGENT_STATE_ROOT;
  delete process.env.PERSONAL_AGENT_REPO_ROOT;
  delete process.env.PERSONAL_AGENT_ACTIVE_PROFILE;
});

describe('memory-cards extension integration', () => {
  it('queries cards and injects MEMORY_CANDIDATES when score threshold is met', async () => {
    const stateRoot = createTempDir('memory-cards-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_REPO_ROOT = createTempDir('memory-cards-repo-');

    const cardsDir = join(stateRoot, 'memory', 'cards', 'workspace');
    mkdirSync(cardsDir, { recursive: true });
    writeFileSync(join(cardsDir, 's1.json'), '{"type":"memory_card"}\n');

    const queryOutput = JSON.stringify([
      {
        score: 0.91,
        file: 'qmd://memory_cards/workspace/s1.json',
        body: JSON.stringify({
          type: 'memory_card',
          session_id: 's1',
          cwd: '/tmp/project',
          subsystems: ['memory'],
          primary_topics: ['qmd', 'memory_cards'],
          durable_decisions: ['Use cards for retrieval injection'],
          invariants: ['Only factual transcript-derived memory'],
          pitfalls: [],
          open_loops: ['Add integration coverage for injection'],
          supersedes: null,
          summary_path: 'workspace/s1.md',
        }),
      },
    ]);

    let beforeAgentStartHandler: ((event: { prompt: string; systemPrompt: string }, ctx: unknown) => Promise<unknown>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt: string; systemPrompt: string }, ctx: unknown) => Promise<unknown>;
        }
      },
      registerTool: vi.fn(),
      exec: vi.fn(async (command: string, args: string[]) => {
        if (command === 'qmd' && args[0] === 'query') {
          return {
            stdout: queryOutput,
            stderr: '',
            code: 0,
            killed: false,
          };
        }

        return {
          stdout: '',
          stderr: '',
          code: 1,
          killed: false,
        };
      }),
    };

    memoryCardsExtension(pi as never);

    expect(beforeAgentStartHandler).toBeDefined();

    const result = await beforeAgentStartHandler!(
      {
        prompt: 'How should we handle memory retrieval?',
        systemPrompt: 'BASE_SYSTEM_PROMPT',
      },
      {
        cwd: '/tmp/project',
        sessionManager: {
          getBranch: () => [],
        },
      },
    ) as { systemPrompt?: string } | undefined;

    expect(pi.exec).toHaveBeenCalled();
    expect(result?.systemPrompt).toContain('BASE_SYSTEM_PROMPT');
    expect(result?.systemPrompt).toContain('MEMORY_CANDIDATES');
    expect(result?.systemPrompt).toContain('session_id=s1');
  });

  it('injects DURABLE_MEMORY block from profile MEMORY.md', async () => {
    const stateRoot = createTempDir('memory-cards-state-');
    const repoRoot = createTempDir('memory-cards-repo-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'shared';

    const memoryDir = join(repoRoot, 'profiles', 'shared', 'agent');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(
      join(memoryDir, 'MEMORY.md'),
      '# Durable Memory\n\n## User\n- Name: Patrick\n\n## Preferences\n- Prefers concise responses\n',
    );

    let beforeAgentStartHandler: ((event: { prompt: string; systemPrompt: string }, ctx: unknown) => Promise<unknown>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt: string; systemPrompt: string }, ctx: unknown) => Promise<unknown>;
        }
      },
      registerTool: vi.fn(),
      exec: vi.fn(async () => ({
        stdout: '[]',
        stderr: '',
        code: 0,
        killed: false,
      })),
    };

    memoryCardsExtension(pi as never);
    expect(beforeAgentStartHandler).toBeDefined();

    const result = await beforeAgentStartHandler!(
      {
        prompt: 'what should you know about me?',
        systemPrompt: 'BASE_SYSTEM_PROMPT',
      },
      {
        cwd: repoRoot,
        sessionManager: {
          getBranch: () => [],
        },
      },
    ) as { systemPrompt?: string } | undefined;

    expect(result?.systemPrompt).toContain('DURABLE_MEMORY');
    expect(result?.systemPrompt).toContain('profile=shared');
    expect(result?.systemPrompt).toContain('Prefers concise responses');
  });

  it('registers memory_update and commits durable memory changes', async () => {
    const repoRoot = createTempDir('memory-cards-repo-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'shared';

    const memoryDir = join(repoRoot, 'profiles', 'shared', 'agent');
    mkdirSync(memoryDir, { recursive: true });

    const registeredTools: Array<{ name?: string; execute?: (...args: unknown[]) => Promise<unknown> }> = [];

    const pi = {
      on: vi.fn(),
      registerTool: vi.fn((tool: { name?: string; execute?: (...args: unknown[]) => Promise<unknown> }) => {
        registeredTools.push(tool);
      }),
      exec: vi.fn(async (command: string, args: string[]) => {
        if (command !== 'git') {
          return {
            stdout: '',
            stderr: '',
            code: 0,
            killed: false,
          };
        }

        if (args.includes('diff')) {
          return {
            stdout: '',
            stderr: '',
            code: 1,
            killed: false,
          };
        }

        return {
          stdout: '',
          stderr: '',
          code: 0,
          killed: false,
        };
      }),
    };

    memoryCardsExtension(pi as never);

    const memoryUpdateTool = registeredTools.find((tool) => tool.name === 'memory_update');
    expect(memoryUpdateTool?.execute).toBeDefined();

    const result = await memoryUpdateTool!.execute!(
      'tool-call-id',
      {
        changes: [
          {
            op: 'upsert',
            section: 'User',
            value: 'Name: Patrick',
          },
        ],
      },
      undefined,
      undefined,
      { cwd: repoRoot },
    ) as { content?: Array<{ text?: string }>; isError?: boolean };

    const memoryPath = join(memoryDir, 'MEMORY.md');
    const memoryText = readFileSync(memoryPath, 'utf-8');

    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]?.text).toContain('Committed and pushed');
    expect(memoryText).toContain('Name: Patrick');
    expect(pi.exec).toHaveBeenCalledWith('git', ['-C', repoRoot, 'add', 'profiles/shared/agent/MEMORY.md']);
    expect(pi.exec).toHaveBeenCalledWith('git', ['-C', repoRoot, 'commit', '-m', 'memory(shared): update durable memory', '--', 'profiles/shared/agent/MEMORY.md']);
    expect(pi.exec).toHaveBeenCalledWith('git', ['-C', repoRoot, 'push']);
  });
});
