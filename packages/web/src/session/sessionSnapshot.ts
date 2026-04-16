import { api } from '../client/api';
import type { SessionMeta } from '../types';

export async function fetchSessionsSnapshot(): Promise<SessionMeta[]> {
  return api.sessions();
}
