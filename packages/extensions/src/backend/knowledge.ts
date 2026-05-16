function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/knowledge must be resolved by the Personal Agent host runtime.');
}

export const readKnowledgeState = (..._args: unknown[]): unknown => hostResolved();
export const updateKnowledgeState = (..._args: unknown[]): unknown => hostResolved();
export const syncKnowledgeState = (..._args: unknown[]): unknown => hostResolved();
