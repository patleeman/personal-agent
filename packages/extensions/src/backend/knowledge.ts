function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/knowledge must be resolved by the Personal Agent host runtime.');
}

export const readKnowledgeState = (..._args: any[]): any => hostResolved();
export const updateKnowledgeState = (..._args: any[]): any => hostResolved();
export const syncKnowledgeState = (..._args: any[]): any => hostResolved();
