import { api } from '../client/api';
import type { SessionMeta } from '../shared/types';

export async function fetchSessionsSnapshot(): Promise<SessionMeta[]> {
  return api.sessions();
}
