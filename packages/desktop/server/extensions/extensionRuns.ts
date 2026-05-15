import { pingDaemon, startBackgroundRun } from '@personal-agent/daemon';

import { cancelDurableRun, getDurableRun, getDurableRunLog, listDurableRuns } from '../automation/durableRuns.js';
import { getExecution, getExecutionLog, listConversationExecutions, listExecutions } from '../executions/executionService.js';
import { invalidateAppTopics } from '../middleware/index.js';

export interface ExtensionRunStartInput {
  prompt: string;
  cwd?: string | null;
  source?: string | null;
  taskSlug?: string | null;
}

function normalizeRunSlug(extensionId: string, input: ExtensionRunStartInput): string {
  const raw = input.taskSlug?.trim() || input.source?.trim() || extensionId;
  const normalized = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `ext-${normalized || extensionId}`;
}

export function createExtensionRunsCapability(extensionId: string) {
  return {
    async start(input: ExtensionRunStartInput) {
      if (!input.prompt || typeof input.prompt !== 'string' || input.prompt.trim().length === 0) {
        throw new Error('prompt is required');
      }
      if (!(await pingDaemon())) {
        throw new Error('Daemon is not responding. Ensure the desktop app is running.');
      }
      const result = await startBackgroundRun({
        taskSlug: normalizeRunSlug(extensionId, input),
        cwd: input.cwd?.trim() || process.cwd(),
        agent: {
          prompt: input.prompt,
          noSession: true,
        },
        source: {
          type: 'app',
          id: `extension:${extensionId}`,
        },
      });
      if (!result.accepted) {
        throw new Error(result.reason ?? 'Could not start run.');
      }
      invalidateAppTopics('executions', 'runs');
      return { runId: result.runId, executionId: result.runId, logPath: result.logPath };
    },
    async get(runId: string) {
      const result = await getDurableRun(runId);
      if (!result) throw new Error('Run not found');
      return result;
    },
    async list() {
      return listDurableRuns();
    },
    async readLog(runId: string, tail?: number) {
      const result = await getDurableRunLog(runId, tail);
      if (!result) throw new Error('Run not found');
      return result;
    },
    async cancel(runId: string) {
      const result = await cancelDurableRun(runId);
      if (!result.cancelled) throw new Error(result.reason ?? 'Could not cancel run.');
      invalidateAppTopics('executions', 'runs');
      return result;
    },
  };
}

export function createExtensionExecutionsCapability(extensionId: string) {
  const runs = createExtensionRunsCapability(extensionId);
  return {
    async start(input: ExtensionRunStartInput) {
      const result = await runs.start(input);
      return { id: result.executionId, runId: result.runId, logPath: result.logPath };
    },
    async get(executionId: string) {
      const result = await getExecution(executionId);
      if (!result) throw new Error('Execution not found');
      return result.execution;
    },
    async list(input?: { conversationId?: string | null }) {
      const conversationId = input?.conversationId?.trim();
      if (conversationId) return (await listConversationExecutions(conversationId)).executions;
      return (await listExecutions()).executions;
    },
    async readLog(executionId: string, tail?: number) {
      const result = await getExecutionLog(executionId, tail);
      if (!result) throw new Error('Execution not found');
      return result;
    },
    async cancel(executionId: string) {
      const result = await cancelDurableRun(executionId);
      if (!result.cancelled) throw new Error(result.reason ?? 'Could not cancel execution.');
      invalidateAppTopics('executions', 'runs');
      return result;
    },
  };
}
