import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
});

describe('memory-cards extension integration', () => {
  it('queries cards and injects MEMORY_CANDIDATES when score threshold is met', async () => {
    const stateRoot = createTempDir('memory-cards-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

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
});
