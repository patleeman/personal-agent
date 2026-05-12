function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/mcp must be resolved by the Personal Agent host runtime.');
}

export const authenticateMcpServer = (..._args: any[]): any => hostResolved();
export const buildMergedMcpConfigDocument = (..._args: any[]): any => hostResolved();
export const callMcpTool = (..._args: any[]): any => hostResolved();
export const clearMcpServerAuth = (..._args: any[]): any => hostResolved();
export const grepMcpTools = (..._args: any[]): any => hostResolved();
export const inspectMcpServer = (..._args: any[]): any => hostResolved();
export const inspectMcpTool = (..._args: any[]): any => hostResolved();
export const listMcpCatalog = (..._args: any[]): any => hostResolved();
export const readBundledSkillMcpManifests = (..._args: any[]): any => hostResolved();
export const readMcpConfigDocument = (..._args: any[]): any => hostResolved();
