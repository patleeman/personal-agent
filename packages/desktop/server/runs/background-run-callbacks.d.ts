import { type ScannedDurableRun } from './store.js';
interface BackgroundRunCallbackDelivery {
    wakeupId?: string;
    deliveredAt?: string;
}
export declare function getBackgroundRunCallbackDelivery(run: ScannedDurableRun): BackgroundRunCallbackDelivery;
export declare function deliverBackgroundRunCallbackWakeup(input: {
    daemonRoot: string;
    stateRoot: string;
    runsRoot: string;
    runId: string;
}): Promise<{
    delivered: boolean;
    wakeupId?: string;
    conversationId?: string;
}>;
export {};
