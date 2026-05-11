import { parentPort } from 'node:worker_threads';

import { loadRawLocalApiModule } from './local-api-module.js';
import { prepareTransferableResultBody } from './worker-transfer.js';

interface LocalApiWorkerRequest {
  id: number;
  methodName: string;
  args: unknown[];
}

interface LocalApiWorkerSuccess {
  id: number;
  ok: true;
  result: unknown;
}

interface LocalApiWorkerFailure {
  id: number;
  ok: false;
  error: string;
}

const localApiModulePromise = loadRawLocalApiModule();

function renderWorkerError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

if (!parentPort) {
  throw new Error('Local API worker requires a parent port.');
}

parentPort.on('message', async (message: LocalApiWorkerRequest) => {
  try {
    const module = await localApiModulePromise;
    const method = (module as unknown as Record<string, unknown>)[message.methodName];
    if (typeof method !== 'function') {
      throw new Error(`Unknown local API method: ${message.methodName}`);
    }

    const result = await method.apply(module, message.args);
    const prepared = prepareTransferableResultBody(result);
    parentPort?.postMessage(
      {
        id: message.id,
        ok: true,
        result: prepared.result,
      } satisfies LocalApiWorkerSuccess,
      prepared.transferList,
    );
  } catch (error) {
    parentPort?.postMessage({
      id: message.id,
      ok: false,
      error: renderWorkerError(error),
    } satisfies LocalApiWorkerFailure);
  }
});
