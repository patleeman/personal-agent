import { fuzzyScore } from './slashMenu';

export interface ModelPickerItem {
  id: string;
  provider: string;
  name: string;
  context: number;
}

export function filterModelPickerItems<T extends ModelPickerItem>(models: T[], query: string): T[] {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return models;
  }

  return [...models]
    .map((model) => {
      const score = Math.max(
        fuzzyScore(trimmedQuery, model.name) ?? Number.NEGATIVE_INFINITY,
        fuzzyScore(trimmedQuery, model.id) ?? Number.NEGATIVE_INFINITY,
        fuzzyScore(trimmedQuery, `${model.provider} ${model.name}`) ?? Number.NEGATIVE_INFINITY,
      );

      return {
        model,
        score: Number.isFinite(score) ? score : null,
      };
    })
    .filter((entry) => entry.score !== null)
    .sort((left, right) => {
      const scoreDelta = (right.score ?? 0) - (left.score ?? 0);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      const providerDelta = left.model.provider.localeCompare(right.model.provider);
      if (providerDelta !== 0) {
        return providerDelta;
      }

      return left.model.name.localeCompare(right.model.name);
    })
    .map((entry) => entry.model);
}
