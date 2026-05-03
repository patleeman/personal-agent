// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockModels = vi.hoisted(() => vi.fn());

vi.mock('../client/api', () => ({
  api: {
    models: mockModels,
  },
}));

import { useConversationModels } from './useConversationModels.js';

describe('useConversationModels', () => {
  it('returns empty state when disabled', () => {
    const { result } = renderHook(() => useConversationModels(false));
    expect(result.current.models).toEqual([]);
    expect(result.current.defaultModel).toBe('');
  });

  it('fetches models when enabled', async () => {
    mockModels.mockResolvedValue({
      models: [{ id: 'gpt-5', name: 'GPT-5', provider: 'openai' }],
      currentModel: 'gpt-5',
      currentThinkingLevel: 'high',
      currentServiceTier: 'standard',
    });

    const { result } = renderHook(() => useConversationModels(true));

    await waitFor(() => expect(result.current.models.length).toBeGreaterThan(0));
    expect(result.current.defaultModel).toBe('gpt-5');
    expect(result.current.defaultThinkingLevel).toBe('high');
    expect(result.current.defaultServiceTier).toBe('standard');
  });

  it('handles api error gracefully', async () => {
    mockModels.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useConversationModels(true));

    // Wait for effects to settle
    await vi.waitFor(() => {});
    expect(result.current.models).toEqual([]);
  });
});
