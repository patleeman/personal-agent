import { readKnowledgeBaseState, syncKnowledgeBaseNow, updateKnowledgeBase } from '@personal-agent/core';

import { invalidateAppTopics } from '../../shared/appEvents.js';

export function readKnowledgeState() {
  return readKnowledgeBaseState();
}

export function updateKnowledgeState(input: { repoUrl?: string | null; branch?: string | null }) {
  const nextState = updateKnowledgeBase(input);
  invalidateAppTopics('knowledgeBase');
  return nextState;
}

export function syncKnowledgeState() {
  const nextState = syncKnowledgeBaseNow();
  invalidateAppTopics('knowledgeBase');
  return nextState;
}
