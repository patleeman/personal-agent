export interface ComposerModelInfo {
  id: string;
  provider: string;
  name: string;
  context: number;
  input?: Array<'text' | 'image'>;
  supportedServiceTiers?: string[];
  reasoning?: boolean;
}

export type ComposerControlSlot = 'leading' | 'preferences' | 'actions';
export type ComposerControlRenderMode = 'inline' | 'menu';

export interface ComposerControlContext {
  composerDisabled: boolean;
  streamIsStreaming: boolean;
  composerHasContent: boolean;
  renderMode: ComposerControlRenderMode;
  openFilePicker: () => void;
  addFiles: (files: File[]) => void;
  insertText: (text: string) => void;
  models: ComposerModelInfo[];
  currentModel: string;
  currentThinkingLevel: string;
  currentServiceTier: string;
  savingPreference: 'model' | 'thinking' | 'serviceTier' | null;
  selectModel: (modelId: string) => void;
  selectThinkingLevel: (thinkingLevel: string) => void;
  selectServiceTier: (enableFastMode: boolean) => void;
  goalEnabled: boolean;
  toggleGoal: () => void;
}

export interface ComposerSubmitContext {
  conversationId?: string;
  text: string;
  attachments: unknown[];
  conversationBusy: boolean;
  streamIsStreaming: boolean;
  modifiers: {
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  };
}

export type ComposerButtonContext = ComposerControlContext;
