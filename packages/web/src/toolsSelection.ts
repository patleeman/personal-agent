export type ToolsRailSelection =
  | { kind: 'agents'; path: string }
  | { kind: 'skill'; path: string }
  | { kind: 'tool'; name: string }
  | { kind: 'package-target'; target: 'profile' | 'local'; profileName?: string }
  | { kind: 'cli'; id: string }
  | { kind: 'mcp-server'; server: string }
  | { kind: 'mcp-tool'; server: string; tool: string };

const INSPECT_PARAM = 'inspect';
const PATH_PARAM = 'path';
const NAME_PARAM = 'name';
const TARGET_PARAM = 'target';
const PROFILE_PARAM = 'profile';
const ID_PARAM = 'id';
const SERVER_PARAM = 'server';
const TOOL_PARAM = 'tool';

const TOOL_SELECTION_PARAMS = [
  INSPECT_PARAM,
  PATH_PARAM,
  NAME_PARAM,
  TARGET_PARAM,
  PROFILE_PARAM,
  ID_PARAM,
  SERVER_PARAM,
  TOOL_PARAM,
] as const;

export function parseToolsSelection(search: string): ToolsRailSelection | null {
  const params = new URLSearchParams(search);
  const inspect = params.get(INSPECT_PARAM)?.trim();

  switch (inspect) {
    case 'agents': {
      const path = params.get(PATH_PARAM)?.trim();
      return path ? { kind: 'agents', path } : null;
    }
    case 'skill': {
      const path = params.get(PATH_PARAM)?.trim();
      return path ? { kind: 'skill', path } : null;
    }
    case 'tool': {
      const name = params.get(NAME_PARAM)?.trim();
      return name ? { kind: 'tool', name } : null;
    }
    case 'package-target': {
      const target = params.get(TARGET_PARAM)?.trim();
      if (target !== 'profile' && target !== 'local') {
        return null;
      }

      const profileName = params.get(PROFILE_PARAM)?.trim() || undefined;
      return {
        kind: 'package-target',
        target,
        profileName,
      };
    }
    case 'cli': {
      const id = params.get(ID_PARAM)?.trim();
      return id ? { kind: 'cli', id } : null;
    }
    case 'mcp-server': {
      const server = params.get(SERVER_PARAM)?.trim();
      return server ? { kind: 'mcp-server', server } : null;
    }
    case 'mcp-tool': {
      const server = params.get(SERVER_PARAM)?.trim();
      const tool = params.get(TOOL_PARAM)?.trim();
      return server && tool ? { kind: 'mcp-tool', server, tool } : null;
    }
    default:
      return null;
  }
}

export function buildToolsSearch(currentSearch: string, selection: ToolsRailSelection | null): string {
  const params = new URLSearchParams(currentSearch);

  for (const key of TOOL_SELECTION_PARAMS) {
    params.delete(key);
  }

  if (selection) {
    params.set(INSPECT_PARAM, selection.kind);

    switch (selection.kind) {
      case 'agents':
      case 'skill':
        params.set(PATH_PARAM, selection.path);
        break;
      case 'tool':
        params.set(NAME_PARAM, selection.name);
        break;
      case 'package-target':
        params.set(TARGET_PARAM, selection.target);
        if (selection.profileName) {
          params.set(PROFILE_PARAM, selection.profileName);
        }
        break;
      case 'cli':
        params.set(ID_PARAM, selection.id);
        break;
      case 'mcp-server':
        params.set(SERVER_PARAM, selection.server);
        break;
      case 'mcp-tool':
        params.set(SERVER_PARAM, selection.server);
        params.set(TOOL_PARAM, selection.tool);
        break;
      default:
        break;
    }
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

export function getToolsSelectionKey(selection: ToolsRailSelection | null): string | null {
  if (!selection) {
    return null;
  }

  switch (selection.kind) {
    case 'agents':
    case 'skill':
      return `${selection.kind}:${selection.path}`;
    case 'tool':
      return `tool:${selection.name}`;
    case 'package-target':
      return `package-target:${selection.target}:${selection.profileName ?? ''}`;
    case 'cli':
      return `cli:${selection.id}`;
    case 'mcp-server':
      return `mcp-server:${selection.server}`;
    case 'mcp-tool':
      return `mcp-tool:${selection.server}:${selection.tool}`;
    default:
      return null;
  }
}
