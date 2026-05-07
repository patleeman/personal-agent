import { type AgentSession, createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';

import { makeAuth, makeRegistry } from './liveSessionFactory.js';
import { type LiveSessionLoaderOptions, makeLoader } from './liveSessionLoader.js';

const NEW_SESSION_PROMPT_PROBE = 'hello';

export interface BeforeAgentStartProbeMessage {
  customType: string;
  content: string;
  display?: boolean;
  details?: unknown;
}

interface BeforeAgentStartProbeRunner {
  emitBeforeAgentStart: (
    prompt: string,
    images: unknown[] | undefined,
    systemPrompt: string,
  ) => Promise<
    | {
        messages?: BeforeAgentStartProbeMessage[];
        systemPrompt?: string;
      }
    | undefined
  >;
}

async function inspectNewSessionRequest(session: AgentSession): Promise<{
  newSessionSystemPrompt: string;
  newSessionInjectedMessages: BeforeAgentStartProbeMessage[];
  newSessionToolDefinitions: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    active: true;
  }>;
}> {
  const baseSystemPrompt = session.systemPrompt;
  const extensionRunner = (session as unknown as { _extensionRunner?: BeforeAgentStartProbeRunner })._extensionRunner;
  const beforeAgentStartResult = extensionRunner
    ? await extensionRunner.emitBeforeAgentStart(NEW_SESSION_PROMPT_PROBE, undefined, baseSystemPrompt)
    : undefined;

  return {
    newSessionSystemPrompt: beforeAgentStartResult?.systemPrompt ?? baseSystemPrompt,
    newSessionInjectedMessages: beforeAgentStartResult?.messages ?? [],
    newSessionToolDefinitions: session.state.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
      active: true as const,
    })),
  };
}

export async function inspectAvailableLiveSessionTools(input: {
  cwd: string;
  agentDir: string;
  options?: LiveSessionLoaderOptions;
}): Promise<{
  cwd: string;
  activeTools: string[];
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    active: boolean;
  }>;
  newSessionSystemPrompt: string;
  newSessionInjectedMessages: BeforeAgentStartProbeMessage[];
  newSessionToolDefinitions: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    active: true;
  }>;
}> {
  const options = input.options ?? {};
  const auth = makeAuth(input.agentDir);
  const resourceLoader = await makeLoader(input.cwd, options);
  const { session } = await createAgentSession({
    cwd: input.cwd,
    agentDir: options.agentDir ?? input.agentDir,
    authStorage: auth,
    modelRegistry: makeRegistry(auth),
    resourceLoader,
    sessionManager: SessionManager.inMemory(input.cwd),
  });

  try {
    const activeTools = session.getActiveToolNames();
    const activeToolSet = new Set(activeTools);
    const tools = session
      .getAllTools()
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as Record<string, unknown>,
        active: activeToolSet.has(tool.name),
      }))
      .sort((left, right) => {
        if (left.active !== right.active) {
          return left.active ? -1 : 1;
        }

        return left.name.localeCompare(right.name);
      });
    const newSessionRequest = await inspectNewSessionRequest(session);

    return {
      cwd: input.cwd,
      activeTools,
      tools,
      ...newSessionRequest,
    };
  } finally {
    session.dispose();
  }
}
