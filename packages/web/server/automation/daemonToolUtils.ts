import { pingDaemon, startDaemonDetached } from '@personal-agent/daemon';

export async function ensureDaemonAvailable(): Promise<void> {
  if (await pingDaemon()) {
    return;
  }

  await startDaemonDetached();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await pingDaemon()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('Daemon did not become available. Start it with: pa daemon start');
}
