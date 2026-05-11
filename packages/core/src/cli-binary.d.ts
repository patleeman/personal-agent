export interface CliBinaryState {
  available: boolean;
  command: string;
  path?: string;
  version?: string;
  error?: string;
}
export declare function inspectCliBinary(options: {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  versionArgs?: string[];
}): CliBinaryState;
