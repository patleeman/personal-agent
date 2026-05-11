export declare const DEFAULT_RESUME_FALLBACK_PROMPT = "Continue from where you left off.";
export declare const DEFAULT_MACHINE_KNOWLEDGE_BASE_BRANCH = "main";
export type MachineConfigSectionKey = 'daemon' | 'ui';
export interface MachineConfigDocument {
    vaultRoot?: string;
    knowledgeBaseRepoUrl?: string;
    knowledgeBaseBranch?: string;
    instructionFiles?: string[];
    skillDirs?: string[];
    daemon?: Record<string, unknown>;
    ui?: Record<string, unknown>;
}
export interface MachineConfigOptions {
    configRoot?: string;
    filePath?: string;
}
export interface MachineUiConfigState {
    resumeFallbackPrompt: string;
}
export interface MachineKnowledgeBaseState {
    repoUrl: string;
    branch: string;
}
export interface WriteMachineUiConfigInput {
    resumeFallbackPrompt?: string;
}
export declare function getMachineConfigFilePath(options?: MachineConfigOptions): string;
export declare function readMachineConfig(options?: MachineConfigOptions): MachineConfigDocument;
export declare function writeMachineConfig(document: MachineConfigDocument, options?: MachineConfigOptions): MachineConfigDocument;
export declare function updateMachineConfig(updater: (current: MachineConfigDocument) => MachineConfigDocument, options?: MachineConfigOptions): MachineConfigDocument;
export declare function readMachineConfigSection(section: MachineConfigSectionKey, options?: MachineConfigOptions): Record<string, unknown> | undefined;
export declare function updateMachineConfigSection(section: MachineConfigSectionKey, updater: (current: Record<string, unknown> | undefined, document: MachineConfigDocument) => Record<string, unknown> | undefined, options?: MachineConfigOptions): MachineConfigDocument;
export declare function readMachineInstructionFiles(options?: MachineConfigOptions): string[];
export declare function writeMachineInstructionFiles(instructionFiles: string[], options?: MachineConfigOptions): MachineConfigDocument;
export declare function readMachineSkillDirs(options?: MachineConfigOptions): string[];
export declare function writeMachineSkillDirs(skillDirs: string[], options?: MachineConfigOptions): MachineConfigDocument;
export declare function readMachineKnowledgeBaseRepoUrl(options?: MachineConfigOptions): string;
export declare function readMachineKnowledgeBaseBranch(options?: MachineConfigOptions): string;
export declare function readMachineKnowledgeBase(options?: MachineConfigOptions): MachineKnowledgeBaseState;
export declare function writeMachineKnowledgeBase(input: {
    repoUrl?: string | null;
    branch?: string | null;
}, options?: MachineConfigOptions): MachineConfigDocument;
export declare function finalizeMachineUiConfigState(config: MachineUiConfigState): MachineUiConfigState;
export declare function readMachineUiConfig(options?: MachineConfigOptions): MachineUiConfigState;
export declare function writeMachineUiConfig(input: WriteMachineUiConfigInput, options?: MachineConfigOptions): MachineUiConfigState;
