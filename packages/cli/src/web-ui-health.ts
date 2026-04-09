export interface ExpectedWebUiReleaseIdentity {
  revision?: string;
}

interface WebUiStatusPayload {
  webUiRevision?: unknown;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function formatExpectedRelease(expected: ExpectedWebUiReleaseIdentity): string {
  return [expected.revision].filter(Boolean).join(' · ');
}

function assertExpectedWebUiStatus(
  payload: WebUiStatusPayload,
  expected: ExpectedWebUiReleaseIdentity | undefined,
): void {
  if (!expected) {
    return;
  }

  if (expected.revision && payload.webUiRevision !== expected.revision) {
    throw new Error(`expected revision ${expected.revision} but got ${String(payload.webUiRevision ?? 'unknown')}`);
  }
}

async function fetchResponse(url: string): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(2_000),
  });
}

async function assertStatusRoute(
  baseUrl: string,
  expectedRelease?: ExpectedWebUiReleaseIdentity,
): Promise<void> {
  const response = await fetchResponse(`${normalizeBaseUrl(baseUrl)}/api/status`);
  if (!response.ok) {
    throw new Error(`/api/status returned HTTP ${response.status}`);
  }

  const payload = await response.json() as WebUiStatusPayload;
  assertExpectedWebUiStatus(payload, expectedRelease);
}

async function assertHtmlRoute(baseUrl: string, path: string): Promise<void> {
  const response = await fetchResponse(`${normalizeBaseUrl(baseUrl)}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('text/html')) {
    throw new Error(`${path} returned ${contentType || 'an unexpected content type'}`);
  }

  const body = await response.text();
  if (!body.includes('<div id="root"></div>')) {
    throw new Error(`${path} did not render the SPA shell`);
  }
}

export async function validateWebUiRoutes(
  baseUrl: string,
  expectedRelease?: ExpectedWebUiReleaseIdentity,
): Promise<void> {
  await assertStatusRoute(baseUrl, expectedRelease);
  await assertHtmlRoute(baseUrl, '/');
  await assertHtmlRoute(baseUrl, '/conversations/new');
}

export async function waitForWebUiHealthy(
  port: number,
  timeoutMs = 30_000,
  expectedRelease?: ExpectedWebUiReleaseIdentity,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const baseUrl = `http://127.0.0.1:${port}`;
  const expectedSuffix = expectedRelease
    ? ` (${formatExpectedRelease(expectedRelease)})`
    : '';
  let lastError = 'timed out';

  while (Date.now() < deadline) {
    try {
      await validateWebUiRoutes(baseUrl, expectedRelease);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }

  throw new Error(`Web UI health check failed on http://localhost:${port}${expectedSuffix}: ${lastError}`);
}
