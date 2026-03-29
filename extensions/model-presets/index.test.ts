import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import modelPresetsExtension from './index';

const {
  readModelPresetLibraryMock,
  resolveModelPresetMock,
  findMatchingModelPresetMock,
  formatModelPresetModelArgumentMock,
} = vi.hoisted(() => ({
  readModelPresetLibraryMock: vi.fn(),
  resolveModelPresetMock: vi.fn(),
  findMatchingModelPresetMock: vi.fn(),
  formatModelPresetModelArgumentMock: vi.fn(),
}));

vi.mock('@personal-agent/resources', () => ({
  readModelPresetLibrary: readModelPresetLibraryMock,
  resolveModelPreset: resolveModelPresetMock,
  findMatchingModelPreset: findMatchingModelPresetMock,
  formatModelPresetModelArgument: formatModelPresetModelArgumentMock,
}));

const PRESET = {
  id: 'cheap-ops',
  description: 'Cheap bounded work',
  provider: 'openai-codex',
  model: 'gpt-5.1-codex-mini',
  modelRef: 'openai-codex/gpt-5.1-codex-mini',
  thinkingLevel: 'off',
  goodFor: ['checkpoint'],
  avoidFor: ['ambiguous debugging'],
  instructionAddendum: 'Move quickly and escalate if the task gets messy.',
};

let tempAgentDir = '';
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

beforeEach(() => {
  tempAgentDir = mkdtempSync(join(tmpdir(), 'pa-model-presets-'));
  mkdirSync(tempAgentDir, { recursive: true });
  writeFileSync(join(tempAgentDir, 'settings.json'), JSON.stringify({ modelPresets: { 'cheap-ops': {} } }));
  process.env.PI_CODING_AGENT_DIR = tempAgentDir;

  readModelPresetLibraryMock.mockReset();
  resolveModelPresetMock.mockReset();
  findMatchingModelPresetMock.mockReset();
  formatModelPresetModelArgumentMock.mockReset();

  readModelPresetLibraryMock.mockReturnValue({
    defaultPresetId: 'cheap-ops',
    presets: [PRESET],
  });
  resolveModelPresetMock.mockReturnValue(PRESET);
  findMatchingModelPresetMock.mockReturnValue(PRESET);
  formatModelPresetModelArgumentMock.mockImplementation((preset: { modelRef: string; thinkingLevel?: string }) => preset.thinkingLevel ? `${preset.modelRef}:${preset.thinkingLevel}` : preset.modelRef);
});

afterEach(() => {
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }
  vi.restoreAllMocks();
});

function registerExtension() {
  let beforeAgentStart:
    | ((event: { systemPrompt: string }, ctx: { sessionManager: { buildSessionContext: () => unknown } }) => { systemPrompt: string } | undefined)
    | undefined;
  let tool:
    | { execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }> }
    | undefined;
  const setModel = vi.fn().mockResolvedValue(true);
  const setThinkingLevel = vi.fn();

  modelPresetsExtension({
    on: (event: string, handler: unknown) => {
      if (event === 'before_agent_start') {
        beforeAgentStart = handler as typeof beforeAgentStart;
      }
    },
    registerTool: (registeredTool: unknown) => {
      tool = registeredTool as typeof tool;
    },
    setModel,
    setThinkingLevel,
  } as never);

  if (!beforeAgentStart || !tool) {
    throw new Error('Extension was not registered completely.');
  }

  return { beforeAgentStart, tool, setModel, setThinkingLevel };
}

function createToolContext() {
  return {
    sessionManager: {
      buildSessionContext: () => ({
        model: {
          provider: 'openai-codex',
          modelId: 'gpt-5.4',
        },
        thinkingLevel: 'high',
      }),
    },
    modelRegistry: {
      getAvailable: () => [{ provider: 'openai-codex', id: 'gpt-5.1-codex-mini' }],
    },
  };
}

describe('model preset extension', () => {
  it('appends the active preset addendum to the system prompt', () => {
    const { beforeAgentStart } = registerExtension();

    const result = beforeAgentStart(
      { systemPrompt: 'BASE_SYSTEM_PROMPT' },
      {
        sessionManager: {
          buildSessionContext: () => ({
            model: { provider: 'openai-codex', modelId: 'gpt-5.1-codex-mini' },
            thinkingLevel: 'off',
          }),
        },
      },
    );

    expect(result?.systemPrompt).toContain('BASE_SYSTEM_PROMPT');
    expect(result?.systemPrompt).toContain('<active-model-preset id="cheap-ops">');
    expect(result?.systemPrompt).toContain(PRESET.instructionAddendum);
  });

  it('switches the current session to a named preset', async () => {
    const { tool, setModel, setThinkingLevel } = registerExtension();
    const result = await tool.execute(
      'tool-1',
      { action: 'set', presetId: 'cheap-ops' },
      undefined,
      undefined,
      createToolContext(),
    );

    expect(result.isError).not.toBe(true);
    expect(setModel).toHaveBeenCalledWith({ provider: 'openai-codex', id: 'gpt-5.1-codex-mini' });
    expect(setThinkingLevel).toHaveBeenCalledWith('off');
    expect(result.content[0]?.text).toContain('Switched to model preset cheap-ops.');
    expect(result.content[0]?.text).toContain('guidance: Move quickly and escalate if the task gets messy.');
    expect(result.details).toMatchObject({
      action: 'set',
      presetId: 'cheap-ops',
      modelRef: 'openai-codex/gpt-5.1-codex-mini',
      thinkingLevel: 'off',
    });
  });
});
