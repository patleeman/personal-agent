// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopCompanionSettingsPanel, formatCompanionTimestamp } from './SettingsPage';
import type { PersonalAgentDesktopBridge } from '../desktop/desktopBridge';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];
const mocks = vi.hoisted(() => ({
  ensureCompanionNetworkReachable: vi.fn(),
  fetch: vi.fn(),
}));

function installDesktopBridge() {
  window.personalAgentDesktop = {
    ensureCompanionNetworkReachable: mocks.ensureCompanionNetworkReachable,
  } as unknown as PersonalAgentDesktopBridge;
  document.documentElement.dataset.personalAgentDesktop = '1';
}

function renderPanel() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<DesktopCompanionSettingsPanel />);
  });

  mountedRoots.push(root);
  return { container };
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function queryButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((node) => node.textContent?.trim() === label);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected button ${label}`);
  }
  return button;
}

function click(button: HTMLButtonElement) {
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('DesktopCompanionSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDesktopBridge();
    mocks.ensureCompanionNetworkReachable.mockResolvedValue({ changed: true, url: 'http://0.0.0.0:3843' });
    mocks.fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (url === '/companion/v1/hello') {
        return new Response(JSON.stringify({
          hostLabel: 'Desktop Mac',
          hostInstanceId: 'host_123',
          protocolVersion: 'v1',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (url === '/companion/v1/admin/devices') {
        return new Response(JSON.stringify({ pendingPairings: [], devices: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (url === '/companion/v1/admin/setup' && init?.method === 'POST') {
        return new Response(JSON.stringify({
          pairing: {
            id: 'pair-1',
            code: 'PAIR-TEST-0001',
            createdAt: '2026-04-19T13:00:00.000Z',
            expiresAt: '2026-04-19T13:10:00.000Z',
          },
          links: [{
            id: '1',
            label: 'en0 · 192.168.1.2',
            baseUrl: 'http://192.168.1.2:3843',
            setupUrl: 'pa-companion://pair?base=http%3A%2F%2F192.168.1.2%3A3843&code=PAIR-TEST-0001',
          }],
          warnings: [],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      throw new Error(`Unexpected fetch ${String(init?.method ?? 'GET')} ${url}`);
    });
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
    document.documentElement.dataset.personalAgentDesktop = '';
    delete window.personalAgentDesktop;
    vi.unstubAllGlobals();
  });

  it('auto-enables local-network companion access before generating a setup QR', async () => {
    const { container } = renderPanel();
    await flushAsyncWork();

    click(queryButton(container, 'Generate setup QR'));
    await flushAsyncWork();
    await flushAsyncWork();

    expect(mocks.ensureCompanionNetworkReachable).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith('/companion/v1/admin/setup', expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
    }));
    expect(container.textContent).toContain('Phone access enabled. Setup QR created.');
    expect(container.textContent).toContain('PAIR-TEST-0001');
    expect(container.textContent).toContain('http://192.168.1.2:3843');
  });

  it('does not format non-ISO companion timestamps as dates', () => {
    expect(formatCompanionTimestamp('1')).toBe('1');
    expect(formatCompanionTimestamp('9999')).toBe('9999');
  });

  it('does not format overflowed companion timestamps as dates', () => {
    expect(formatCompanionTimestamp('2026-04-31T09:00:00.000Z')).toBe('2026-04-31T09:00:00.000Z');
  });
});
