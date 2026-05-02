/**
 * P1: CLI argument and default model behavior tests
 * Tests applyDefaultModelArgs and passthrough behavior
 */

import { describe, it, expect } from 'vitest';

// Re-implement the function for isolated testing
function applyDefaultModelArgs(args: string[], settings: Record<string, unknown>): string[] {
  const output = [...args];

  const hasModel = output.includes('--model');
  const hasThinking = output.includes('--thinking');

  const defaultProvider = settings.defaultProvider;
  const defaultModel = settings.defaultModel;
  const defaultThinkingLevel = settings.defaultThinkingLevel;

  if (!hasModel && typeof defaultProvider === 'string' && typeof defaultModel === 'string') {
    output.push('--model', `${defaultProvider}/${defaultModel}`);
  }

  if (!hasThinking && typeof defaultThinkingLevel === 'string') {
    output.push('--thinking', defaultThinkingLevel);
  }

  return output;
}

describe('applyDefaultModelArgs', () => {
  it('adds --model when not present and defaults are available', () => {
    const args = ['-p', 'hello'];
    const settings = {
      defaultProvider: 'test-provider',
      defaultModel: 'test-model',
    };

    const result = applyDefaultModelArgs(args, settings);

    expect(result).toContain('--model');
    expect(result).toContain('test-provider/test-model');
  });

  it('does not override existing --model', () => {
    const args = ['--model', 'custom/provider', '-p', 'hello'];
    const settings = {
      defaultProvider: 'test-provider',
      defaultModel: 'test-model',
    };

    const result = applyDefaultModelArgs(args, settings);

    expect(result).toContain('--model');
    expect(result.indexOf('custom/provider')).toBe(result.indexOf('--model') + 1);
    expect(result).not.toContain('test-provider/test-model');
  });

  it('adds --thinking when not present and default is available', () => {
    const args = ['-p', 'hello'];
    const settings = {
      defaultThinkingLevel: 'low',
    };

    const result = applyDefaultModelArgs(args, settings);

    expect(result).toContain('--thinking');
    expect(result).toContain('low');
  });

  it('does not override existing --thinking', () => {
    const args = ['--thinking', 'high', '-p', 'hello'];
    const settings = {
      defaultThinkingLevel: 'low',
    };

    const result = applyDefaultModelArgs(args, settings);

    expect(result).toContain('--thinking');
    expect(result.indexOf('high')).toBe(result.indexOf('--thinking') + 1);
    expect(result).not.toContain('low');
  });

  it('adds both --model and --thinking when neither is present', () => {
    const args = ['-p', 'hello'];
    const settings = {
      defaultProvider: 'openai',
      defaultModel: 'gpt-4',
      defaultThinkingLevel: 'medium',
    };

    const result = applyDefaultModelArgs(args, settings);

    expect(result).toContain('--model');
    expect(result).toContain('openai/gpt-4');
    expect(result).toContain('--thinking');
    expect(result).toContain('medium');
  });

  it('does not add --model if defaultProvider is missing', () => {
    const args = ['-p', 'hello'];
    const settings = {
      defaultModel: 'test-model',
    };

    const result = applyDefaultModelArgs(args, settings);

    expect(result).not.toContain('--model');
  });

  it('does not add --model if defaultModel is missing', () => {
    const args = ['-p', 'hello'];
    const settings = {
      defaultProvider: 'test-provider',
    };

    const result = applyDefaultModelArgs(args, settings);

    expect(result).not.toContain('--model');
  });

  it('does not add --model if defaultProvider is not a string', () => {
    const args = ['-p', 'hello'];
    const settings = {
      defaultProvider: 123,
      defaultModel: 'test-model',
    };

    const result = applyDefaultModelArgs(args, settings);

    expect(result).not.toContain('--model');
  });

  it('does not add --model if defaultModel is not a string', () => {
    const args = ['-p', 'hello'];
    const settings = {
      defaultProvider: 'test-provider',
      defaultModel: null,
    };

    const result = applyDefaultModelArgs(args, settings);

    expect(result).not.toContain('--model');
  });

  it('does not add --thinking if defaultThinkingLevel is not a string', () => {
    const args = ['-p', 'hello'];
    const settings = {
      defaultThinkingLevel: 1,
    };

    const result = applyDefaultModelArgs(args, settings);

    expect(result).not.toContain('--thinking');
  });

  it('handles empty args array', () => {
    const args: string[] = [];
    const settings = {
      defaultProvider: 'anthropic',
      defaultModel: 'claude',
      defaultThinkingLevel: 'off',
    };

    const result = applyDefaultModelArgs(args, settings);

    expect(result).toEqual(['--model', 'anthropic/claude', '--thinking', 'off']);
  });

  it('handles empty settings object', () => {
    const args = ['-p', 'hello'];
    const settings = {};

    const result = applyDefaultModelArgs(args, settings);

    expect(result).toEqual(['-p', 'hello']);
  });

  it('preserves original args order when adding defaults', () => {
    const args = ['--verbose', '-p', 'hello', '--session', 'test.json'];
    const settings = {
      defaultProvider: 'test',
      defaultModel: 'model',
    };

    const result = applyDefaultModelArgs(args, settings);

    expect(result.slice(0, 4)).toEqual(['--verbose', '-p', 'hello', '--session']);
    expect(result).toContain('test/model');
  });

  it('handles --model with different flag formats', () => {
    const args = ['--model', 'provider/model', '--thinking', 'high'];
    const settings = {
      defaultProvider: 'other',
      defaultModel: 'other-model',
      defaultThinkingLevel: 'low',
    };

    const result = applyDefaultModelArgs(args, settings);

    expect(result.filter(a => a === '--model').length).toBe(1);
    expect(result.filter(a => a === '--thinking').length).toBe(1);
  });
});

describe('CLI passthrough behavior around --', () => {
  // Simulate the passthrough logic from index.ts
  function resolvePassthroughArgs(args: string[]): { passthrough: string[]; hasDoubleDash: boolean } {
    const hasDoubleDash = args[0] === '--';
    const passthroughArgs = hasDoubleDash ? args.slice(1) : args;
    return { passthrough: passthroughArgs, hasDoubleDash };
  }

  it('removes leading -- when present', () => {
    const args = ['--', '--model', 'test/model', '-p', 'hello'];
    const result = resolvePassthroughArgs(args);

    expect(result.hasDoubleDash).toBe(true);
    expect(result.passthrough).toEqual(['--model', 'test/model', '-p', 'hello']);
  });

  it('preserves args when -- is not present', () => {
    const args = ['-p', 'hello', '--model', 'test/model'];
    const result = resolvePassthroughArgs(args);

    expect(result.hasDoubleDash).toBe(false);
    expect(result.passthrough).toEqual(['-p', 'hello', '--model', 'test/model']);
  });

  it('handles empty args after --', () => {
    const args = ['--'];
    const result = resolvePassthroughArgs(args);

    expect(result.hasDoubleDash).toBe(true);
    expect(result.passthrough).toEqual([]);
  });

  it('handles empty args without --', () => {
    const args: string[] = [];
    const result = resolvePassthroughArgs(args);

    expect(result.hasDoubleDash).toBe(false);
    expect(result.passthrough).toEqual([]);
  });

  it('preserves -- within the args (not at position 0)', () => {
    const args = ['-p', 'hello', '--', '--model', 'test'];
    const result = resolvePassthroughArgs(args);

    // -- is not at position 0, so it should be treated as part of passthrough
    expect(result.hasDoubleDash).toBe(false);
    expect(result.passthrough).toEqual(['-p', 'hello', '--', '--model', 'test']);
  });
});
