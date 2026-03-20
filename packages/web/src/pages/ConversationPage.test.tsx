import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionTargetSummary } from '../types.js';
import { ConversationPage, DraftExecutionTargetSelector } from './ConversationPage.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('ConversationPage', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (typeof message === 'string' && message.includes('useLayoutEffect does nothing on the server')) {
        return;
      }

      originalConsoleError(message, ...args);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('hides the draft execution selector when no remote targets are configured', () => {
    const html = renderToString(
      <DraftExecutionTargetSelector
        execution={{
          targetId: null,
          location: 'local',
          target: null,
        }}
        targets={[]}
        busy={false}
        onSelectTarget={() => {}}
      />,
    );

    expect(html).toBe('');
  });

  it('renders the draft execution selector when remote targets are available', () => {
    const target: ExecutionTargetSummary = {
      id: 'gpu-box',
      label: 'GPU Box',
      transport: 'ssh',
      sshDestination: 'patrick@gpu-box',
      cwdMappings: [],
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:00.000Z',
      activeRunCount: 0,
      readyImportCount: 0,
    };

    const html = renderToString(
      <DraftExecutionTargetSelector
        execution={{
          targetId: null,
          location: 'local',
          target: null,
        }}
        targets={[target]}
        busy={false}
        onSelectTarget={() => {}}
      />,
    );

    expect(html).toContain('Execution');
    expect(html).toContain('Local agent');
    expect(html).toContain('GPU Box');
  });

  it('renders without reading tree state before initialization', () => {
    expect(() => renderToString(
      <MemoryRouter initialEntries={['/conversations/test-session']}>
        <Routes>
          <Route path="/conversations/:id" element={<ConversationPage />} />
        </Routes>
      </MemoryRouter>,
    )).not.toThrow();
  });
});
