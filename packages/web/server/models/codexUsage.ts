import { AuthStorage, type OAuthCredential } from '@mariozechner/pi-coding-agent';

const OPENAI_CODEX_PROVIDER = 'openai-codex';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const OPENAI_AUTH_JWT_CLAIM_PATH = 'https://api.openai.com/auth';
const REQUEST_TIMEOUT_MS = 10_000;

export interface CodexPlanUsageWindowSummary {
  remainingPercent: number;
  usedPercent: number;
  windowMinutes: number | null;
  resetsAt: string | null;
}

export interface CodexPlanCreditsSummary {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
}

export interface CodexPlanUsageState {
  available: boolean;
  planType: string | null;
  fiveHour: CodexPlanUsageWindowSummary | null;
  weekly: CodexPlanUsageWindowSummary | null;
  credits: CodexPlanCreditsSummary | null;
  updatedAt: string | null;
  error: string | null;
}

interface RawRateLimitWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
}

interface RawRateLimitDetails {
  primary_window?: RawRateLimitWindow | null;
  secondary_window?: RawRateLimitWindow | null;
}

interface RawCredits {
  has_credits?: boolean;
  unlimited?: boolean;
  balance?: string | null;
}

interface RawCodexUsagePayload {
  plan_type?: string;
  rate_limit?: RawRateLimitDetails | null;
  credits?: RawCredits | null;
}

function emptyUsageState(available: boolean, error: string | null = null): CodexPlanUsageState {
  return {
    available,
    planType: null,
    fiveHour: null,
    weekly: null,
    credits: null,
    updatedAt: null,
    error,
  };
}

function isOAuthCredential(credential: ReturnType<AuthStorage['get']>): credential is OAuthCredential {
  return credential?.type === 'oauth';
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1];
    if (!payload) {
      return null;
    }

    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractAccountId(token: string, credential: OAuthCredential): string | null {
  if (typeof credential.accountId === 'string' && credential.accountId.trim().length > 0) {
    return credential.accountId.trim();
  }

  const payload = decodeJwtPayload(token);
  const authClaim = payload?.[OPENAI_AUTH_JWT_CLAIM_PATH];
  if (!authClaim || typeof authClaim !== 'object' || Array.isArray(authClaim)) {
    return null;
  }

  const accountId = (authClaim as { chatgpt_account_id?: unknown }).chatgpt_account_id;
  return typeof accountId === 'string' && accountId.trim().length > 0 ? accountId.trim() : null;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

function normalizeWindow(window: RawRateLimitWindow | null | undefined): CodexPlanUsageWindowSummary | null {
  if (!window) {
    return null;
  }

  const usedPercentRaw = typeof window.used_percent === 'number' ? window.used_percent : null;
  const windowMinutes = typeof window.limit_window_seconds === 'number' && Number.isFinite(window.limit_window_seconds) && window.limit_window_seconds > 0
    ? Math.round(window.limit_window_seconds / 60)
    : null;
  const resetsAt = typeof window.reset_at === 'number' && Number.isFinite(window.reset_at) && window.reset_at > 0
    ? new Date(window.reset_at * 1000).toISOString()
    : null;

  if (usedPercentRaw === null && windowMinutes === null && resetsAt === null) {
    return null;
  }

  const usedPercent = clampPercent(usedPercentRaw ?? 0);
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    windowMinutes,
    resetsAt,
  };
}

function normalizeCredits(credits: RawCredits | null | undefined): CodexPlanCreditsSummary | null {
  if (!credits) {
    return null;
  }

  const balance = typeof credits.balance === 'string' && credits.balance.trim().length > 0
    ? credits.balance.trim()
    : null;

  return {
    hasCredits: credits.has_credits === true,
    unlimited: credits.unlimited === true,
    balance,
  };
}

function splitWindows(rateLimit: RawRateLimitDetails | null | undefined): {
  fiveHour: CodexPlanUsageWindowSummary | null;
  weekly: CodexPlanUsageWindowSummary | null;
} {
  const primary = normalizeWindow(rateLimit?.primary_window);
  const secondary = normalizeWindow(rateLimit?.secondary_window);

  if (!primary && !secondary) {
    return { fiveHour: null, weekly: null };
  }

  if (!primary) {
    return { fiveHour: null, weekly: secondary };
  }

  if (!secondary) {
    return { fiveHour: primary, weekly: null };
  }

  if (primary.windowMinutes !== null && secondary.windowMinutes !== null && primary.windowMinutes > secondary.windowMinutes) {
    return { fiveHour: secondary, weekly: primary };
  }

  return { fiveHour: primary, weekly: secondary };
}

function normalizePlanType(planType: unknown): string | null {
  if (typeof planType !== 'string' || planType.trim().length === 0) {
    return null;
  }

  return planType
    .trim()
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function parseErrorMessage(status: number, statusText: string, bodyText: string): string {
  const fallback = `${status} ${statusText}`.trim();
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return fallback || 'Failed to fetch Codex usage.';
  }

  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: unknown } | string; message?: unknown };
    if (typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
      return parsed.error.trim();
    }
    if (parsed.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error)) {
      const message = (parsed.error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return message.trim();
      }
    }
    if (typeof parsed.message === 'string' && parsed.message.trim().length > 0) {
      return parsed.message.trim();
    }
  } catch {
    // Ignore non-JSON bodies.
  }

  return trimmed.length > 240 ? `${trimmed.slice(0, 237)}…` : trimmed;
}

function createTimeoutController(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

export async function readCodexPlanUsage(authFile: string): Promise<CodexPlanUsageState> {
  const authStorage = AuthStorage.create(authFile);
  const credential = authStorage.get(OPENAI_CODEX_PROVIDER);
  if (!isOAuthCredential(credential)) {
    return emptyUsageState(false);
  }

  try {
    const token = await authStorage.getApiKey(OPENAI_CODEX_PROVIDER);
    if (!token) {
      return emptyUsageState(true, 'Codex OAuth credentials are present, but no access token is available right now.');
    }

    const refreshedCredential = authStorage.get(OPENAI_CODEX_PROVIDER);
    const accountId = isOAuthCredential(refreshedCredential)
      ? extractAccountId(token, refreshedCredential)
      : extractAccountId(token, credential);

    if (!accountId) {
      return emptyUsageState(true, 'Codex OAuth credentials are missing a ChatGPT account id.');
    }

    const timeout = createTimeoutController(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(CODEX_USAGE_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          'ChatGPT-Account-Id': accountId,
          accept: 'application/json',
          originator: 'pi',
          'User-Agent': 'personal-agent-web',
        },
        signal: timeout.signal,
      });
    } finally {
      timeout.clear();
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      return emptyUsageState(true, parseErrorMessage(response.status, response.statusText, bodyText));
    }

    const payload = await response.json() as RawCodexUsagePayload;
    const { fiveHour, weekly } = splitWindows(payload.rate_limit);

    return {
      available: true,
      planType: normalizePlanType(payload.plan_type),
      fiveHour,
      weekly,
      credits: normalizeCredits(payload.credits),
      updatedAt: new Date().toISOString(),
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message === 'This operation was aborted'
      ? 'Timed out while fetching Codex plan usage.'
      : message;
    return emptyUsageState(true, normalized);
  }
}
