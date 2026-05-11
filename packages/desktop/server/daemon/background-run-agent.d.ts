export interface BackgroundRunAgentSpec {
    prompt: string;
    /** @deprecated Ignored; background agents always use the shared runtime scope. */
    profile?: string;
    model?: string;
    noSession?: boolean;
    /** When set, only these tool names are exposed to the background agent. */
    allowedTools?: string[];
}
export declare function looksLikePersonalAgentCliEntryPath(value: string | undefined): boolean;
export declare function buildBackgroundAgentArgv(spec: BackgroundRunAgentSpec): string[];
