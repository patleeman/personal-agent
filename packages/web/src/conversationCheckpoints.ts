export const CONVERSATION_CHECKPOINTS_QUERY_PARAM = 'checkpoints';

export function shouldOpenConversationCheckpointsFromSearch(search: string): boolean {
  const value = new URLSearchParams(search).get(CONVERSATION_CHECKPOINTS_QUERY_PARAM)?.trim().toLowerCase();
  if (!value) {
    return false;
  }

  return value === '1' || value === 'true' || value === 'yes' || value === 'open';
}

export function setConversationCheckpointsOpenInSearch(search: string, open: boolean): string {
  const params = new URLSearchParams(search);

  if (open) {
    params.set(CONVERSATION_CHECKPOINTS_QUERY_PARAM, '1');
  } else {
    params.delete(CONVERSATION_CHECKPOINTS_QUERY_PARAM);
  }

  const next = params.toString();
  return next.length > 0 ? `?${next}` : '';
}
