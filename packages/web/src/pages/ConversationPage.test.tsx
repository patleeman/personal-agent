import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationPage } from './ConversationPage.js';

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
