import type { URLSearchParamsInit } from 'react-router-dom';

export interface KnowledgeSearchNavigateOptions {
  replace?: boolean;
}

export type SetKnowledgeSearchParams = (nextInit?: URLSearchParamsInit, navigateOptions?: KnowledgeSearchNavigateOptions) => void;

export function navigateKnowledgeFile(
  setSearchParams: SetKnowledgeSearchParams,
  id: string,
  options: KnowledgeSearchNavigateOptions = {},
): void {
  const trimmedId = id.trim();

  if (!trimmedId) {
    setSearchParams({}, options);
    return;
  }

  setSearchParams({ file: trimmedId }, options);
}
