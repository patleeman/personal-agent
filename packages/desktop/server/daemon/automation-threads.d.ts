import { type AutomationThreadMode, type StoredAutomation } from './automation-store.js';
export declare function ensureAutomationThread(taskId: string, options?: {
    dbPath?: string;
    stateRoot?: string;
}): StoredAutomation;
export declare function resolveAutomationThreadTitle(task: Pick<StoredAutomation, 'title' | 'id' | 'threadMode'>): string | undefined;
export declare function normalizeAutomationThreadModeForSelection(value: string | null | undefined): AutomationThreadMode;
