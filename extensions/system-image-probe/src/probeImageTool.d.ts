import { type ExtensionAPI } from '@earendil-works/pi-coding-agent';
export declare function createImageProbeAgentExtension(options: { getPreferredVisionModel: () => string }): (pi: ExtensionAPI) => void;
