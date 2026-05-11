import { type ResolveMemoryDocsOptions } from './memory-docs.js';
export interface MemoryDocParseError {
  filePath: string;
  error: string;
}
export interface ParsedMemoryDoc {
  filePath: string;
  dirPath: string;
  fileName: string;
  packageId: string;
  packagePath: string;
  id: string;
  title: string;
  summary: string;
  description?: string;
  type: string;
  status: string;
  area?: string;
  role?: string;
  parent?: string;
  related: string[];
  updated: string;
  body: string;
  metadata: Record<string, unknown>;
  referencePaths: string[];
}
export interface ParsedMemoryReference {
  filePath: string;
  fileName: string;
  relativePath: string;
  id: string;
  title: string;
  summary: string;
  updated: string;
  body: string;
  metadata: Record<string, unknown>;
}
export interface LoadMemoryDocsOptions extends ResolveMemoryDocsOptions {}
export interface LoadMemoryDocsResult {
  memoryDir: string;
  docs: ParsedMemoryDoc[];
  parseErrors: MemoryDocParseError[];
}
export interface FindMemoryDocsFilters {
  type?: string;
  status?: string;
  area?: string;
  role?: string;
  parent?: string;
  text?: string;
}
export interface MemoryDocDuplicateId {
  id: string;
  files: string[];
}
export interface CreateMemoryDocInput {
  id: string;
  title: string;
  summary: string;
  description?: string;
  type?: string;
  status?: string;
  area?: string;
  role?: string;
  parent?: string;
  related?: string[];
  updated?: string;
  force?: boolean;
}
export interface CreateMemoryDocResult {
  memoryDir: string;
  filePath: string;
  id: string;
  title: string;
  summary: string;
  description?: string;
  type: string;
  status: string;
  area?: string;
  role?: string;
  parent?: string;
  related: string[];
  updated: string;
  overwritten: boolean;
}
export interface MemoryDocReferenceError {
  filePath: string;
  id: string;
  field: 'parent' | 'related';
  targetId: string;
  error: string;
}
export interface LintMemoryDocsResult {
  memoryDir: string;
  checked: number;
  validDocs: number;
  parseErrors: MemoryDocParseError[];
  duplicateIds: MemoryDocDuplicateId[];
  referenceErrors: MemoryDocReferenceError[];
}
export declare function validateMemoryDocId(id: string): void;
export declare function loadMemoryDocs(options?: LoadMemoryDocsOptions): LoadMemoryDocsResult;
export declare function loadMemoryPackageReferences(packagePath: string): ParsedMemoryReference[];
export declare function resolveMemoryDocById(docs: ParsedMemoryDoc[], id: string): ParsedMemoryDoc;
export declare function collectDuplicateMemoryDocIds(docs: ParsedMemoryDoc[]): MemoryDocDuplicateId[];
export declare function collectMemoryDocReferenceErrors(docs: ParsedMemoryDoc[]): MemoryDocReferenceError[];
export declare function filterMemoryDocs(docs: ParsedMemoryDoc[], filters?: FindMemoryDocsFilters): ParsedMemoryDoc[];
export declare function normalizeCsvValues(rawValues: string[]): string[];
export declare function currentDateYyyyMmDd(now?: Date): string;
export declare function buildMemoryDocTemplate(options: {
  id: string;
  title: string;
  summary: string;
  description?: string;
  type?: string;
  status?: string;
  area?: string;
  role?: string;
  parent?: string;
  related?: string[];
  updated?: string;
}): string;
export declare function createMemoryDoc(input: CreateMemoryDocInput, options?: ResolveMemoryDocsOptions): CreateMemoryDocResult;
export declare function lintMemoryDocs(options?: ResolveMemoryDocsOptions): LintMemoryDocsResult;
