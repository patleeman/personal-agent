import { EventEmitter } from 'node:events';

import type { DesktopRemoteOperationStatus } from './hosts/types.js';

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

const REMOTE_OPERATION_EVENT = 'remote-operation';

export function emitDesktopRemoteOperationStatus(event: DesktopRemoteOperationStatus): void {
  emitter.emit(REMOTE_OPERATION_EVENT, event);
}

export function subscribeDesktopRemoteOperationStatus(listener: (event: DesktopRemoteOperationStatus) => void): () => void {
  emitter.on(REMOTE_OPERATION_EVENT, listener);
  return () => {
    emitter.off(REMOTE_OPERATION_EVENT, listener);
  };
}
