export interface ResolveActivityConversationLinkOptions {
    profile: string;
    stateRoot?: string;
}
export interface ResolveActivityConversationLinkPathOptions extends ResolveActivityConversationLinkOptions {
    activityId: string;
}
export interface ActivityConversationLinkDocument {
    activityId: string;
    updatedAt: string;
    relatedConversationIds: string[];
}
export declare function resolveProfileActivityConversationLinksDir(options: ResolveActivityConversationLinkOptions): string;
export declare function resolveActivityConversationLinkPath(options: ResolveActivityConversationLinkPathOptions): string;
export declare function readActivityConversationLink(path: string): ActivityConversationLinkDocument;
export declare function getActivityConversationLink(options: ResolveActivityConversationLinkPathOptions): ActivityConversationLinkDocument | null;
export declare function writeActivityConversationLink(options: {
    stateRoot?: string;
    profile: string;
    document: ActivityConversationLinkDocument;
}): string;
export declare function setActivityConversationLinks(options: {
    stateRoot?: string;
    profile: string;
    activityId: string;
    relatedConversationIds: string[];
    updatedAt?: string;
}): ActivityConversationLinkDocument | null;
export declare function clearActivityConversationLinks(options: {
    stateRoot?: string;
    profile: string;
    activityId: string;
}): void;
