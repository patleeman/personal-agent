import type { DaemonConfig } from '../config.js';
/**
 * Minimal runtime interface for task execution in the daemon.
 * The full CompanionRuntime was extracted into the system-codex extension.
 * This is kept temporarily until the daemon package is collapsed into
 * the desktop server, at which point tasks-runner.ts will import
 * the live session functions directly.
 */
export interface CompanionRuntime {
    createConversation(input: {
        cwd?: string;
        model?: string;
        thinkingLevel?: string;
        serviceTier?: string;
    }): Promise<unknown>;
    resumeConversation(input: {
        sessionFile: string;
        cwd?: string;
    }): Promise<unknown>;
    promptConversation(input: {
        conversationId: string;
        text?: string;
        images?: unknown[];
        behavior?: string;
        surfaceId?: string;
    }): Promise<unknown>;
    subscribeConversation(input: {
        conversationId: string;
        tailBlocks?: number;
        surfaceId?: string;
        surfaceType?: string;
    }, onEvent: (event: unknown) => void): Promise<() => void>;
    readConversationBootstrap(input: {
        conversationId: string;
        tailBlocks?: number;
    }): Promise<unknown>;
    abortConversation(input: {
        conversationId: string;
    }): Promise<unknown>;
    updateConversationModelPreferences(input: {
        conversationId: string;
        model?: string | null;
        thinkingLevel?: string | null;
        serviceTier?: string | null;
        surfaceId?: string;
    }): Promise<unknown>;
}
export type CompanionRuntimeProvider = (config: DaemonConfig) => CompanionRuntime | Promise<CompanionRuntime>;
