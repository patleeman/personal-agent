function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/mcp must be resolved by the Personal Agent host runtime.');
}

export const authenticateMcpServer = (..._args: unknown[]): unknown => hostResolved();
export const buildMergedMcpConfigDocument = (..._args: unknown[]): unknown => hostResolved();
export const callMcpTool = (..._args: unknown[]): unknown => hostResolved();
export const clearMcpServerAuth = (..._args: unknown[]): unknown => hostResolved();
export const grepMcpTools = (..._args: unknown[]): unknown => hostResolved();
export const inspectMcpServer = (..._args: unknown[]): unknown => hostResolved();
export const inspectMcpTool = (..._args: unknown[]): unknown => hostResolved();
export const listMcpCatalog = (..._args: unknown[]): unknown => hostResolved();
export const readBundledSkillMcpManifests = (..._args: unknown[]): unknown => hostResolved();
export const readMcpConfigDocument = (..._args: unknown[]): unknown => hostResolved();
