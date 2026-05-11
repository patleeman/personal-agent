export interface ResolveConversationLinkOptions {
  profile: string;
  stateRoot?: string;
}
export interface ResolveConversationLinkPathOptions extends ResolveConversationLinkOptions {
  conversationId: string;
}
export interface ConversationProjectLinkDocument {
  conversationId: string;
  updatedAt: string;
  relatedProjectIds: string[];
}
export declare function validateConversationId(conversationId: string): void;
export declare function resolveProfileConversationLinksDir(options: ResolveConversationLinkOptions): string;
export declare function resolveConversationLinkPath(options: ResolveConversationLinkPathOptions): string;
export declare function readConversationProjectLink(path: string): ConversationProjectLinkDocument;
export declare function listConversationProjectLinks(options: ResolveConversationLinkOptions): ConversationProjectLinkDocument[];
export declare function listConversationIdsForProject(
  options: ResolveConversationLinkOptions & {
    projectId: string;
  },
): string[];
export declare function getConversationProjectLink(options: ResolveConversationLinkPathOptions): ConversationProjectLinkDocument | null;
export declare function writeConversationProjectLink(options: {
  stateRoot?: string;
  profile: string;
  document: ConversationProjectLinkDocument;
}): string;
export declare function setConversationProjectLinks(options: {
  stateRoot?: string;
  profile: string;
  conversationId: string;
  relatedProjectIds: string[];
  updatedAt?: string;
}): ConversationProjectLinkDocument;
export declare function addConversationProjectLink(options: {
  stateRoot?: string;
  profile: string;
  conversationId: string;
  projectId: string;
  updatedAt?: string;
}): ConversationProjectLinkDocument;
export declare function removeConversationProjectLink(options: {
  stateRoot?: string;
  profile: string;
  conversationId: string;
  projectId: string;
  updatedAt?: string;
}): ConversationProjectLinkDocument;
