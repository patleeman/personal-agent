import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export declare function createRunAgentExtension(options: {
  getCurrentProfile: () => string;
  repoRoot: string;
  profilesRoot: string;
}): (pi: ExtensionAPI) => void;
