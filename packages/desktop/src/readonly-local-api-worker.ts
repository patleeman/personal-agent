import { parentPort } from 'node:worker_threads';

import { type DesktopLocalApiDispatchResult, loadRawLocalApiModule } from './local-api-module.js';
import { prepareTransferableResultBody } from './worker-transfer.js';

interface ReadonlyLocalApiWorkerRequest {
  id: number;
  input: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  };
}

interface ReadonlyLocalApiWorkerSuccess {
  id: number;
  ok: true;
  result: DesktopLocalApiDispatchResult;
}

interface ReadonlyLocalApiWorkerFailure {
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
  throw new Error('Readonly local API worker requires a parent port.');
}

parentPort.on('message', async (message: ReadonlyLocalApiWorkerRequest) => {
  try {
    const module = await localApiModulePromise;
    const result = await module.dispatchDesktopLocalApiRequest(message.input);
    const prepared = prepareTransferableResultBody(result);
    parentPort?.postMessage(
      {
        id: message.id,
        ok: true,
        result: prepared.result,
      } satisfies ReadonlyLocalApiWorkerSuccess,
      prepared.transferList,
    );
  } catch (error) {
    parentPort?.postMessage({
      id: message.id,
      ok: false,
      error: renderWorkerError(error),
    } satisfies ReadonlyLocalApiWorkerFailure);
  }
});
