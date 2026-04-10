import type { DesktopApiStreamEvent } from './types.js';

async function readStreamError(response: Response): Promise<string> {
  try {
    const data = await response.json() as { error?: string };
    if (typeof data.error === 'string' && data.error.trim().length > 0) {
      return data.error;
    }
  } catch {
    // Ignore malformed error payloads.
  }

  return `${response.status} ${response.statusText}`;
}

export async function proxyApiStream(
  baseUrl: string,
  path: string,
  onEvent: (event: DesktopApiStreamEvent) => void,
): Promise<() => void> {
  const abortController = new AbortController();
  const response = await fetch(new URL(path, baseUrl), {
    headers: { Accept: 'text/event-stream' },
    signal: abortController.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(await readStreamError(response));
  }

  onEvent({ type: 'open' });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let closed = false;

  const close = () => {
    if (closed) {
      return;
    }

    closed = true;
    onEvent({ type: 'close' });
  };

  void (async () => {
    try {
      let reading = true;
      while (reading) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let scanning = true;
        while (scanning) {
          const separatorMatch = buffer.match(/\r?\n\r?\n/);
          if (!separatorMatch || typeof separatorMatch.index !== 'number') {
            scanning = false;
            continue;
          }

          const separatorLength = separatorMatch[0].length;
          const chunk = buffer.slice(0, separatorMatch.index);
          buffer = buffer.slice(separatorMatch.index + separatorLength);

          const data = chunk
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');

          if (data.length > 0) {
            onEvent({ type: 'message', data });
          }
        }

        reading = !abortController.signal.aborted;
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        onEvent({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      close();
    }
  })();

  return () => {
    abortController.abort();
    close();
  };
}
