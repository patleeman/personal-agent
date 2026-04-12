export interface HostApiDispatchResult {
  statusCode: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

function decodeBody(body: Uint8Array): string {
  return Buffer.from(body).toString('utf-8');
}

function readHeader(headers: Record<string, string>, name: string): string {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }

  return '';
}

export function readApiDispatchError(result: HostApiDispatchResult): string {
  const contentType = readHeader(result.headers, 'content-type');
  const bodyText = decodeBody(result.body);

  if (contentType.toLowerCase().includes('application/json')) {
    try {
      const payload = JSON.parse(bodyText) as { error?: string };
      if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
        return payload.error;
      }
    } catch {
      // Ignore malformed JSON error bodies.
    }
  }

  return bodyText.trim() || `HTTP ${String(result.statusCode)}`;
}

export function parseApiDispatchResult<T = unknown>(result: HostApiDispatchResult): T {
  const contentType = readHeader(result.headers, 'content-type');
  const bodyText = decodeBody(result.body);

  if (contentType.toLowerCase().includes('application/json')) {
    return JSON.parse(bodyText) as T;
  }

  return bodyText as T;
}
