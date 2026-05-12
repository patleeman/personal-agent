export interface ComposerButtonContext {
  composerDisabled: boolean;
  streamIsStreaming: boolean;
  composerHasContent: boolean;
  renderMode: 'inline' | 'menu';
  goalEnabled: boolean;
  toggleGoal: () => void;
  insertText: (text: string) => void;
}
