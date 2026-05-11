declare const ARTIFACT_KINDS: readonly ['html', 'mermaid', 'latex'];
export type ConversationArtifactKind = (typeof ARTIFACT_KINDS)[number];
export interface ResolveConversationArtifactOptions {
  profile: string;
  conversationId: string;
  stateRoot?: string;
}
export interface ResolveConversationArtifactPathOptions extends ResolveConversationArtifactOptions {
  artifactId: string;
}
export interface ConversationArtifactSummary {
  id: string;
  conversationId: string;
  title: string;
  kind: ConversationArtifactKind;
  createdAt: string;
  updatedAt: string;
  revision: number;
}
export interface ConversationArtifactRecord extends ConversationArtifactSummary {
  content: string;
}
export declare function validateConversationArtifactId(artifactId: string): void;
export declare function validateConversationArtifactKind(kind: string): asserts kind is ConversationArtifactKind;
export declare function resolveProfileConversationArtifactsDir(options: { profile: string; stateRoot?: string }): string;
export declare function resolveConversationArtifactsDir(options: ResolveConversationArtifactOptions): string;
export declare function resolveConversationArtifactPath(options: ResolveConversationArtifactPathOptions): string;
export declare function readConversationArtifact(path: string): ConversationArtifactRecord;
export declare function getConversationArtifact(options: ResolveConversationArtifactPathOptions): ConversationArtifactRecord | null;
export declare function listConversationArtifacts(options: ResolveConversationArtifactOptions): ConversationArtifactSummary[];
export declare function saveConversationArtifact(options: {
  profile: string;
  conversationId: string;
  artifactId?: string;
  title: string;
  kind: ConversationArtifactKind;
  content: string;
  stateRoot?: string;
  createdAt?: string;
  updatedAt?: string;
}): ConversationArtifactRecord;
export declare function deleteConversationArtifact(options: ResolveConversationArtifactPathOptions): boolean;
export {};
