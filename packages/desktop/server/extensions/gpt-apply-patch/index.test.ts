import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import gptApplyPatchExtension, { syncToolSelection } from './index';

type ToolDefinition = {
  name: string;
  execute: (...args: unknown[]) => Promise<unknown>;
  parameters: unknown;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: readonly string[];
};

function createPiHarness(initialTools: string[] = ['read', 'bash', 'edit', 'write']) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const registeredTools = new Map<string, ToolDefinition>();
  let activeTools = [...initialTools];

  return {
    pi: {
      registerTool(tool: ToolDefinition) {
        registeredTools.set(tool.name, tool);
      },
      on(eventName: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(eventName, handler);
      },
      getActiveTools() {
        return [...activeTools];
      },
      setActiveTools(nextTools: string[]) {
        activeTools = [...nextTools];
      },
    },
    getHandler<T extends (...args: unknown[]) => unknown>(eventName: string): T {
      const handler = handlers.get(eventName);
      if (!handler) {
        throw new Error(`Missing handler for ${eventName}`);
      }
      return handler as T;
    },
    getTool(name: string): ToolDefinition {
      const tool = registeredTools.get(name);
      if (!tool) {
        throw new Error(`Missing tool ${name}`);
      }
      return tool;
    },
    getActiveTools() {
      return [...activeTools];
    },
  };
}

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'personal-agent-gpt-apply-patch-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('gpt apply_patch extension', () => {
  it('registers apply_patch and swaps it in on session start for GPT models', () => {
    const harness = createPiHarness();
    gptApplyPatchExtension(harness.pi as never);

    expect(harness.getTool('apply_patch').name).toBe('apply_patch');

    const sessionStart = harness.getHandler<(event: unknown, ctx: { model: { id: string } }) => void>('session_start');
    sessionStart({}, { model: { id: 'gpt-5.4' } });

    expect(harness.getActiveTools()).toEqual(['read', 'bash', 'apply_patch', 'write']);
  });

  it('restores edit when the active model is not GPT', () => {
    const harness = createPiHarness(['read', 'bash', 'apply_patch', 'write']);
    gptApplyPatchExtension(harness.pi as never);

    const modelSelect = harness.getHandler<(event: { model: { id: string } }) => void>('model_select');
    modelSelect({ model: { id: 'claude-sonnet-4-5' } });

    expect(harness.getActiveTools()).toEqual(['read', 'bash', 'edit', 'write']);
  });

  it('re-enforces the tool swap before a turn starts if a GPT session drifted back to edit', () => {
    const harness = createPiHarness();
    gptApplyPatchExtension(harness.pi as never);

    syncToolSelection(harness.pi as never, { id: 'gpt-5.4' });
    expect(harness.getActiveTools()).toEqual(['read', 'bash', 'apply_patch', 'write']);

    harness.pi.setActiveTools(['read', 'bash', 'edit', 'write']);
    const beforeAgentStart = harness.getHandler<(event: unknown, ctx: { model: { id: string } }) => void>('before_agent_start');
    beforeAgentStart({}, { model: { id: 'gpt-5.4' } });

    expect(harness.getActiveTools()).toEqual(['read', 'bash', 'apply_patch', 'write']);
  });

  it('executes the registered tool against the conversation cwd', async () => {
    const harness = createPiHarness();
    gptApplyPatchExtension(harness.pi as never);

    const dir = await createTempDir();
    await mkdir(join(dir, 'src'), { recursive: true });
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'src', 'app.ts'), '', 'utf8');

    const tool = harness.getTool('apply_patch');
    const result = await tool.execute(
      'tool-call-1',
      {
        input: `*** Begin Patch
*** Add File: docs/notes.md
+line one
*** Update File: src/app.ts
@@
+console.log('hi');
*** End Patch`,
      },
      undefined,
      undefined,
      { cwd: dir },
    ) as {
      content: Array<{ type: 'text'; text: string }>;
      details: { added: string[]; modified: string[]; deleted: string[] };
    };

    expect(result.content[0]?.text).toBe('Success. Updated the following files:\nA docs/notes.md\nM src/app.ts');
    expect(result.details).toEqual({
      added: ['docs/notes.md'],
      modified: ['src/app.ts'],
      deleted: [],
    });

    await expect(readFile(join(dir, 'docs', 'notes.md'), 'utf8')).resolves.toBe('line one\n');
    await expect(readFile(join(dir, 'src', 'app.ts'), 'utf8')).resolves.toBe("console.log('hi');\n");
  });
});
