export interface ResolveNodesOptions {
  vaultRoot?: string;
}
export interface UnifiedNodeParseError {
  filePath: string;
  error: string;
}
export interface UnifiedNodeRelationship {
  type: string;
  targetId: string;
}
export interface UnifiedNodeLinkInfo {
  parent?: string;
  related: string[];
  conversations: string[];
  relationships: UnifiedNodeRelationship[];
}
export interface UnifiedNodeRecord {
  id: string;
  title: string;
  summary: string;
  description?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  type: string;
  kinds: string[];
  tags: string[];
  profiles: string[];
  parentTag?: string;
  links: UnifiedNodeLinkInfo;
  body: string;
  filePath: string;
  dirPath: string;
  searchText: string;
}
export interface LoadUnifiedNodesResult {
  nodesDir: string;
  nodes: UnifiedNodeRecord[];
  parseErrors: UnifiedNodeParseError[];
}
export interface CreateUnifiedNodeInput {
  id: string;
  title: string;
  summary: string;
  description?: string;
  status?: string;
  tags?: string[];
  parent?: string;
  related?: string[];
  relationships?: UnifiedNodeRelationship[];
  body?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  force?: boolean;
}
export interface CreateUnifiedNodeResult {
  nodesDir: string;
  node: UnifiedNodeRecord;
  overwritten: boolean;
}
export interface UpdateUnifiedNodeInput {
  id: string;
  title?: string;
  summary?: string;
  description?: string | null;
  status?: string;
  addTags?: string[];
  removeTags?: string[];
  parent?: string | null;
  related?: string[];
  relationships?: UnifiedNodeRelationship[];
  body?: string;
}
export interface TagUnifiedNodeInput {
  id: string;
  add?: string[];
  remove?: string[];
}
export interface UnifiedNodeReferenceError {
  filePath: string;
  id: string;
  field: 'parent' | 'related';
  targetId: string;
  error: string;
}
export interface UnifiedNodeDuplicateId {
  id: string;
  files: string[];
}
export interface LintUnifiedNodesResult {
  nodesDir: string;
  checked: number;
  validNodes: number;
  parseErrors: UnifiedNodeParseError[];
  duplicateIds: UnifiedNodeDuplicateId[];
  referenceErrors: UnifiedNodeReferenceError[];
}
export interface LegacyNodeMigrationConflict {
  id: string;
  kinds: string[];
  sources: string[];
}
export interface LegacyNodeMigrationResult {
  nodesDir: string;
  created: string[];
  updated: string[];
  skipped: string[];
  conflicts: LegacyNodeMigrationConflict[];
}
export declare function resolveUnifiedNodesDir(options?: ResolveNodesOptions): string;
export declare function matchesUnifiedNodeQuery(node: UnifiedNodeRecord, query: string | undefined): boolean;
export declare function validateUnifiedNodeId(id: string): void;
export declare function loadUnifiedNodes(options?: ResolveNodesOptions): LoadUnifiedNodesResult;
export declare function findUnifiedNodeById(nodes: UnifiedNodeRecord[], id: string): UnifiedNodeRecord;
export declare function findUnifiedNodes(nodes: UnifiedNodeRecord[], query?: string): UnifiedNodeRecord[];
export declare function createUnifiedNode(input: CreateUnifiedNodeInput, options?: ResolveNodesOptions): CreateUnifiedNodeResult;
export declare function updateUnifiedNode(input: UpdateUnifiedNodeInput, options?: ResolveNodesOptions): UnifiedNodeRecord;
export declare function deleteUnifiedNode(
  id: string,
  options?: ResolveNodesOptions,
): {
  ok: true;
  id: string;
};
export declare function tagUnifiedNode(input: TagUnifiedNodeInput, options?: ResolveNodesOptions): UnifiedNodeRecord;
export declare function collectDuplicateUnifiedNodeIds(nodes: UnifiedNodeRecord[]): UnifiedNodeDuplicateId[];
export declare function collectUnifiedNodeReferenceErrors(nodes: UnifiedNodeRecord[]): UnifiedNodeReferenceError[];
export declare function lintUnifiedNodes(options?: ResolveNodesOptions): LintUnifiedNodesResult;
export declare function migrateLegacyNodes(options?: ResolveNodesOptions): LegacyNodeMigrationResult;
export declare function listUnifiedSkillNodeDirs(profile: string, options?: ResolveNodesOptions): string[];
