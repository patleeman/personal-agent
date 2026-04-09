import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCodexPlanUsage } from './codexUsage.js';

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-codex-usage-'));
  tempDirs.push(dir);
  return dir;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64url');
}

function createCodexAccessToken(accountId: string): string {
  return [
    encodeBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' })),
    encodeBase64Url(JSON.stringify({
      'https://api.openai.com/auth': {
        chatgpt_account_id: accountId,
      },
    })),
    'signature',
  ].join('.');
}

function writeAuthFile(authFile: string, credential: Record<string, unknown>): void {
  writeFileSync(authFile, JSON.stringify({ 'openai-codex': credential }, null, 2), 'utf-8');
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('readCodexPlanUsage', () => {
  it('returns unavailable when openai-codex is not using OAuth', async () => {
    const dir = createTempDir();
    const authFile = join(dir, 'auth.json');
    writeAuthFile(authFile, {
      type: 'api_key',
      key: 'sk-test',
    });

    const state = await readCodexPlanUsage(authFile);

    expect(state).toEqual({
      available: false,
      planType: null,
      fiveHour: null,
      weekly: null,
      credits: null,
      updatedAt: null,
      error: null,
    });
  });

  it('returns an actionable error when the OAuth credential has no usable access token', async () => {
    const dir = createTempDir();
    const authFile = join(dir, 'auth.json');
    writeAuthFile(authFile, {
      type: 'oauth',
      access: '',
      refresh: 'refresh-token',
      expires: Date.now() + 60_000,
      accountId: 'account-123',
    });

    const state = await readCodexPlanUsage(authFile);

    expect(state).toEqual({
      available: true,
      planType: null,
      fiveHour: null,
      weekly: null,
      credits: null,
      updatedAt: null,
      error: 'Codex OAuth credentials are present, but no access token is available right now.',
    });
  });

  it('parses the codex usage payload into compact indicators', async () => {
    const dir = createTempDir();
    const authFile = join(dir, 'auth.json');
    const access = createCodexAccessToken('account-123');

    writeAuthFile(authFile, {
      type: 'oauth',
      access,
      refresh: 'refresh-token',
      expires: Date.now() + 60_000,
      accountId: 'account-123',
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://chatgpt.com/backend-api/wham/usage');
      expect((init?.headers as Record<string, string>)['ChatGPT-Account-Id']).toBe('account-123');
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${access}`);
      return new Response(JSON.stringify({
        plan_type: 'pro',
        rate_limit: {
          primary_window: {
            used_percent: 11,
            limit_window_seconds: 18_000,
            reset_at: 1_775_100_000,
          },
          secondary_window: {
            used_percent: 13,
            limit_window_seconds: 604_800,
            reset_at: 1_775_700_000,
          },
        },
        credits: {
          has_credits: true,
          unlimited: false,
          balance: '188',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const state = await readCodexPlanUsage(authFile);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(state.available).toBe(true);
    expect(state.planType).toBe('Pro');
    expect(state.fiveHour).toEqual({
      usedPercent: 11,
      remainingPercent: 89,
      windowMinutes: 300,
      resetsAt: new Date(1_775_100_000 * 1000).toISOString(),
    });
    expect(state.weekly).toEqual({
      usedPercent: 13,
      remainingPercent: 87,
      windowMinutes: 10_080,
      resetsAt: new Date(1_775_700_000 * 1000).toISOString(),
    });
    expect(state.credits).toEqual({
      hasCredits: true,
      unlimited: false,
      balance: '188',
    });
    expect(state.error).toBeNull();
    expect(typeof state.updatedAt).toBe('string');
  });

  it('derives the ChatGPT account id from the JWT and normalizes odd payload shapes', async () => {
    const dir = createTempDir();
    const authFile = join(dir, 'auth.json');
    const access = createCodexAccessToken('account-from-jwt');

    writeAuthFile(authFile, {
      type: 'oauth',
      access,
      refresh: 'refresh-token',
      expires: Date.now() + 60_000,
      accountId: '   ',
    });

    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['ChatGPT-Account-Id']).toBe('account-from-jwt');
      return new Response(JSON.stringify({
        plan_type: 'chatgpt_pro_enterprise',
        rate_limit: {
          primary_window: {
            used_percent: 150,
            limit_window_seconds: 604_800,
            reset_at: 0,
          },
          secondary_window: {
            used_percent: -5,
            limit_window_seconds: 18_000,
            reset_at: Number.NaN,
          },
        },
        credits: {
          has_credits: false,
          unlimited: true,
          balance: '   ',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const state = await readCodexPlanUsage(authFile);

    expect(state.planType).toBe('Chatgpt Pro Enterprise');
    expect(state.fiveHour).toEqual({
      usedPercent: 0,
      remainingPercent: 100,
      windowMinutes: 300,
      resetsAt: null,
    });
    expect(state.weekly).toEqual({
      usedPercent: 100,
      remainingPercent: 0,
      windowMinutes: 10_080,
      resetsAt: null,
    });
    expect(state.credits).toEqual({
      hasCredits: false,
      unlimited: true,
      balance: null,
    });
  });

  it('reports a missing account id before fetching usage', async () => {
    const dir = createTempDir();
    const authFile = join(dir, 'auth.json');

    writeAuthFile(authFile, {
      type: 'oauth',
      access: 'invalid.jwt',
      refresh: 'refresh-token',
      expires: Date.now() + 60_000,
    });

    const state = await readCodexPlanUsage(authFile);

    expect(state).toEqual({
      available: true,
      planType: null,
      fiveHour: null,
      weekly: null,
      credits: null,
      updatedAt: null,
      error: 'Codex OAuth credentials are missing a ChatGPT account id.',
    });
  });

  it('keeps the indicator available and reports fetch errors for codex oauth accounts', async () => {
    const dir = createTempDir();
    const authFile = join(dir, 'auth.json');
    writeAuthFile(authFile, {
      type: 'oauth',
      access: createCodexAccessToken('account-xyz'),
      refresh: 'refresh-token',
      expires: Date.now() + 60_000,
      accountId: 'account-xyz',
    });

    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'usage endpoint unavailable' },
    }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })) as typeof globalThis.fetch;

    const state = await readCodexPlanUsage(authFile);

    expect(state).toEqual({
      available: true,
      planType: null,
      fiveHour: null,
      weekly: null,
      credits: null,
      updatedAt: null,
      error: 'usage endpoint unavailable',
    });
  });

  it('normalizes abort errors as usage fetch timeouts', async () => {
    const dir = createTempDir();
    const authFile = join(dir, 'auth.json');
    writeAuthFile(authFile, {
      type: 'oauth',
      access: createCodexAccessToken('account-timeout'),
      refresh: 'refresh-token',
      expires: Date.now() + 60_000,
      accountId: 'account-timeout',
    });

    globalThis.fetch = vi.fn(async () => {
      throw new Error('This operation was aborted');
    }) as typeof globalThis.fetch;

    const state = await readCodexPlanUsage(authFile);

    expect(state).toEqual({
      available: true,
      planType: null,
      fiveHour: null,
      weekly: null,
      credits: null,
      updatedAt: null,
      error: 'Timed out while fetching Codex plan usage.',
    });
  });
});
