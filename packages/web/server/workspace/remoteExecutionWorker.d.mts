export const REMOTE_EXECUTION_RESULT_FILE: string;
export const REMOTE_EXECUTION_SESSION_FILE: string;
export const LOCAL_PA_CLI_PATH: string;

export function buildRemoteRunCommand(
  bundle: {
    target: {
      profile?: string | null;
      commandPrefix?: string | null;
    };
    remoteCwd: string;
    prompt: string;
  },
  remoteTempDir: string,
  remotePaCommand: string,
): {
  remoteBootstrapPath: string;
  remoteSessionsDir: string;
  command: string;
};

export function runRemoteExecutionWorker(bundlePath?: string): Promise<void>;
