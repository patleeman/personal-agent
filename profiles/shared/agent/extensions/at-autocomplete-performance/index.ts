import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { CombinedAutocompleteProvider, type AutocompleteItem } from '@mariozechner/pi-tui';

const PATCH_FLAG = '__personalAgentAtAutocompletePatched' as const;
const ORIGINAL_GET_FUZZY_FILE_SUGGESTIONS = '__personalAgentAtAutocompleteOriginalGetFuzzyFileSuggestions' as const;

type GetFuzzyFileSuggestions = (
  this: CombinedAutocompleteProvider,
  query: string,
  options: { isQuotedPrefix: boolean },
) => AutocompleteItem[];

interface CombinedAutocompleteProviderPatchState {
  getFuzzyFileSuggestions: GetFuzzyFileSuggestions;
  getFileSuggestions?: (prefix: string) => AutocompleteItem[];
  [PATCH_FLAG]?: boolean;
  [ORIGINAL_GET_FUZZY_FILE_SUGGESTIONS]?: GetFuzzyFileSuggestions;
}

function patchCombinedAutocompleteProvider(): void {
  const prototype = CombinedAutocompleteProvider.prototype as unknown as CombinedAutocompleteProviderPatchState;

  if (prototype[PATCH_FLAG]) {
    return;
  }

  const originalGetFuzzyFileSuggestions = prototype.getFuzzyFileSuggestions as GetFuzzyFileSuggestions;

  prototype[ORIGINAL_GET_FUZZY_FILE_SUGGESTIONS] = originalGetFuzzyFileSuggestions;
  prototype.getFuzzyFileSuggestions = function patchedGetFuzzyFileSuggestions(
    this: CombinedAutocompleteProvider,
    query: string,
    options: { isQuotedPrefix: boolean },
  ): AutocompleteItem[] {
    const provider = this as unknown as { getFileSuggestions?: (prefix: string) => AutocompleteItem[] };

    if (!provider.getFileSuggestions) {
      return originalGetFuzzyFileSuggestions.call(this, query, options);
    }

    const syntheticPrefix = options.isQuotedPrefix
      ? `@"${query}`
      : `@${query}`;

    return provider.getFileSuggestions(syntheticPrefix) ?? [];
  };

  prototype[PATCH_FLAG] = true;
}

export default function atAutocompletePerformanceExtension(_pi: ExtensionAPI): void {
  patchCombinedAutocompleteProvider();
}
