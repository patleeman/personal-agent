import { setTimeout as delay } from 'node:timers/promises';
import { pingDaemon } from '@personal-agent/daemon';

async function checkWebUi(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitForDaemonHealthy(timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await pingDaemon()) {
      return;
    }

    await delay(200);
  }

  throw new Error(`Timed out waiting for daemon health after ${String(timeoutMs)}ms.`);
}

export async function waitForWebUiHealthy(baseUrl: string, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();
  const statusUrl = new URL('/api/status', baseUrl).toString();

  while (Date.now() - startedAt < timeoutMs) {
    if (await checkWebUi(statusUrl)) {
      return;
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for web UI health at ${statusUrl}.`);
}

export async function isWebUiHealthy(baseUrl: string): Promise<boolean> {
  const statusUrl = new URL('/api/status', baseUrl).toString();
  return checkWebUi(statusUrl);
}
