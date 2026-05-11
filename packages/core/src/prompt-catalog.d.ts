export type PromptCatalogVariables = Record<string, string | number | boolean | null | undefined>;
export declare function getPromptCatalogRoot(explicitRepoRoot?: string): string;
export declare function readPromptCatalogEntry(relativePath: string, options?: {
    repoRoot?: string;
}): string | undefined;
export declare function requirePromptCatalogEntry(relativePath: string, options?: {
    repoRoot?: string;
}): string;
export interface RenderPromptCatalogTemplateOptions {
    templateRoot?: string;
}
export declare function renderPromptCatalogTemplate(template: string, variables?: PromptCatalogVariables, options?: RenderPromptCatalogTemplateOptions): string;
