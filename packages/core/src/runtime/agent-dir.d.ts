import { type RuntimeStatePaths } from './paths.js';
export interface PreparePiAgentDirOptions {
    statePaths: RuntimeStatePaths;
}
export interface PreparePiAgentDirResult {
    agentDir: string;
    authFile: string;
    sessionsDir: string;
}
export declare function preparePiAgentDir(options: PreparePiAgentDirOptions): Promise<PreparePiAgentDirResult>;
