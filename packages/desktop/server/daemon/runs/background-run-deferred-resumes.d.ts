export interface BackgroundRunResultSummary {
    id: string;
    sessionFile: string;
    prompt: string;
    surfacedAt: string;
    runIds: string[];
}
export declare function listPendingBackgroundRunResults(input: {
    runsRoot: string;
    sessionFile: string;
}): BackgroundRunResultSummary[];
export declare function markBackgroundRunResultsDelivered(input: {
    runsRoot: string;
    sessionFile: string;
    resultIds: string[];
    deliveredAt?: string;
}): string[];
export declare function surfaceBackgroundRunResultsIfReady(input: {
    runsRoot: string;
    triggerRunId: string;
    now?: Date;
}): Promise<{
    resultId?: string;
    surfacedRunIds: string[];
}>;
