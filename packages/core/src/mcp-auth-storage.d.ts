export interface LockfileData {
  pid: number;
  port: number;
  timestamp: number;
}
export declare function readJsonFile<T>(
  serverUrlHash: string,
  filename: string,
  schema: {
    parseAsync: (value: unknown) => Promise<T>;
  },
): Promise<T | undefined>;
export declare function writeJsonFile(serverUrlHash: string, filename: string, data: unknown): Promise<void>;
export declare function readTextFile(serverUrlHash: string, filename: string): Promise<string | undefined>;
export declare function writeTextFile(serverUrlHash: string, filename: string, text: string): Promise<void>;
export declare function deleteConfigFile(serverUrlHash: string, filename: string): Promise<void>;
export declare function createLockfile(serverUrlHash: string, pid: number, port: number): Promise<void>;
export declare function checkLockfile(serverUrlHash: string): Promise<LockfileData | null>;
export declare function deleteLockfile(serverUrlHash: string): Promise<void>;
