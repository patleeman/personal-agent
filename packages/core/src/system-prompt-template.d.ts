export type SystemPromptTemplateVariables = Record<
  string,
  string | number | boolean | null | undefined | Array<Record<string, string | undefined>>
>;
export declare const SYSTEM_PROMPT_TEMPLATE: string;
export declare function renderSystemPromptTemplate(variables?: SystemPromptTemplateVariables): string;
