import type { StartBackgroundRunInput } from './background-runs.js';
import type { ScannedDurableRun } from './store.js';
export declare function buildRerunBackgroundRunInput(run: ScannedDurableRun): StartBackgroundRunInput;
export declare function buildFollowUpBackgroundRunInput(run: ScannedDurableRun, prompt: string): StartBackgroundRunInput;
