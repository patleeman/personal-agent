import { type DeferredResumeRecord } from '@personal-agent/core';
export declare function buildDeferredResumeActivityId(record: DeferredResumeRecord): string;
export declare function buildDeferredResumeAlertId(record: DeferredResumeRecord): string;
export declare function surfaceReadyDeferredResume(input: {
    entry: DeferredResumeRecord;
    repoRoot?: string;
    profile: string;
    stateRoot: string;
    conversationId?: string;
}): {
    activityId?: string;
    alertId?: string;
};
