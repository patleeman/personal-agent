import { type ExtensionAPI } from '@earendil-works/pi-coding-agent';
export interface ParsedImageGenerationSse {
  assistantText: string;
  imageBase64: string;
  outputFormat: string;
  quality?: string;
  background?: string;
  responseId?: string;
}
export declare function parseImageGenerationSse(raw: string): ParsedImageGenerationSse;
export declare function createImageAgentExtension(): (pi: ExtensionAPI) => void;
