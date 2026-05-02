import { useEffect, useState } from 'react';

import { api } from '../client/api';
import type { ModelInfo } from '../shared/types';

export function useConversationModels(enabled: boolean) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [defaultThinkingLevel, setDefaultThinkingLevel] = useState<string>('');
  const [defaultServiceTier, setDefaultServiceTier] = useState<string>('');

  useEffect(() => {
    if (!enabled) {
      return;
    }

    api
      .models()
      .then((data) => {
        setModels(data.models);
        setDefaultModel(data.currentModel);
        setDefaultThinkingLevel(data.currentThinkingLevel ?? '');
        setDefaultServiceTier(data.currentServiceTier ?? '');
      })
      .catch(() => {});
  }, [enabled]);

  return {
    models,
    defaultModel,
    defaultThinkingLevel,
    defaultServiceTier,
  };
}
