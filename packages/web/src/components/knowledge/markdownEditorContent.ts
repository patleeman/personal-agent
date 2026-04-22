export interface MarkdownReadableEditor {
  getMarkdown?: () => string;
}

export function readMarkdownFromEditor(editor: MarkdownReadableEditor | null | undefined): string {
  return typeof editor?.getMarkdown === 'function'
    ? editor.getMarkdown()
    : '';
}
