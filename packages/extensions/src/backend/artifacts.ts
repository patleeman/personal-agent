export type ConversationArtifactKind = 'html' | 'mermaid' | 'latex';

export interface ConversationArtifactRecord {
  id: string;
  title: string;
  kind: ConversationArtifactKind;
  content: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ConversationArtifactSummary {
  id: string;
  title: string;
  kind: ConversationArtifactKind;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ConversationArtifactSelector {
  profile: string;
  conversationId: string;
}

/**
 * Backend imports are resolved by the Personal Agent host when building trusted
 * local extensions. This package subpath exists so tooling has a real public
 * contract; runtime implementations are provided by the desktop host alias.
 */
function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/artifacts must be resolved by the Personal Agent host runtime.');
}

export function listConversationArtifacts(_input: ConversationArtifactSelector): ConversationArtifactSummary[] {
  return hostResolved();
}

export function getConversationArtifact(_input: ConversationArtifactSelector & { artifactId: string }): ConversationArtifactRecord | null {
  return hostResolved();
}

export function saveConversationArtifact(
  _input: ConversationArtifactSelector & {
    artifactId?: string;
    title: string;
    kind: ConversationArtifactKind;
    content: string;
  },
): ConversationArtifactRecord {
  return hostResolved();
}

export function deleteConversationArtifact(_input: ConversationArtifactSelector & { artifactId: string }): boolean {
  return hostResolved();
}
