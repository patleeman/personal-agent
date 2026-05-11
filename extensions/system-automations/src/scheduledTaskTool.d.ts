import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export declare function createScheduledTaskAgentExtension(options: { getCurrentProfile: () => string }): (pi: ExtensionAPI) => void;
