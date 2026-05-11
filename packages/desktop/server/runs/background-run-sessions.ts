import { getDurableSessionsDir } from '@personal-agent/core';
import { join } from 'path';

const BACKGROUND_RUN_SESSIONS_DIR_NAME = '__runs';

export function resolveBackgroundRunSessionDir(runId: string): string {
  return join(getDurableSessionsDir(), BACKGROUND_RUN_SESSIONS_DIR_NAME, runId);
}
