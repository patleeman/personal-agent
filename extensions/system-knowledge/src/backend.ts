import { readKnowledgeState, syncKnowledgeState, updateKnowledgeState } from '@personal-agent/extensions/backend';

export function readState() {
  return readKnowledgeState();
}

export function updateState(input: { repoUrl?: string | null; branch?: string | null }) {
  return updateKnowledgeState(input);
}

export function sync() {
  return syncKnowledgeState();
}
