import { join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_PA_CLI_PATH,
  REMOTE_EXECUTION_RESULT_FILE,
  REMOTE_EXECUTION_SESSION_FILE,
  buildRemoteRunCommand,
} from './remoteExecutionWorker.mjs';

describe('remoteExecutionWorker', () => {
  it('resolves the local pa CLI relative to the worker module', () => {
    expect(normalize(LOCAL_PA_CLI_PATH)).toContain(normalize(join('packages', 'cli', 'dist', 'index.js')));
    expect(REMOTE_EXECUTION_RESULT_FILE).toBe('remote-execution.json');
    expect(REMOTE_EXECUTION_SESSION_FILE).toBe('remote-session.jsonl');
  });

  it('builds the remote run command from the request bundle', () => {
    const bundle = {
      target: {
        id: 'gpu-box',
        label: 'GPU Box',
        sshDestination: 'gpu-box',
        profile: 'datadog',
        commandPrefix: 'source ~/.bashrc',
      },
      remoteCwd: '/srv/workspace',
      prompt: 'Investigate the remote worker startup path.',
    };

    const result = buildRemoteRunCommand(bundle, '/tmp/pa-remote-run-123', '/usr/local/bin/pa');

    expect(result.remoteBootstrapPath).toBe('/tmp/pa-remote-run-123/bootstrap-session.jsonl');
    expect(result.remoteSessionsDir).toBe('/tmp/pa-remote-run-123/sessions');
    expect(result.command).toContain("mkdir -p '/tmp/pa-remote-run-123/sessions'");
    expect(result.command).toContain("cd '/srv/workspace'");
    expect(result.command).toContain("source ~/.bashrc && /usr/local/bin/pa tui --profile 'datadog'");
    expect(result.command).toContain("--fork '/tmp/pa-remote-run-123/bootstrap-session.jsonl'");
    expect(result.command).toContain("--session-dir '/tmp/pa-remote-run-123/sessions'");
    expect(result.command).toContain("-p 'Investigate the remote worker startup path.'");
  });
});
