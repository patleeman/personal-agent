import { readGitRepoInfo } from './gitStatus.js';
import { runConversationAutomationJudge, type ConversationAutomationJudgeDecision, type ConversationAutomationJudgeModelRegistry } from './conversationAutomationJudge.js';

export type ConversationAutomationFilterField = 'tool' | 'event' | 'repo' | 'prompt';
export type ConversationAutomationFilterFieldAlias = ConversationAutomationFilterField | 'judge';
export type ConversationAutomationFilterTrigger = 'manual' | 'turn_end';
export type ConversationAutomationFilterOperator = 'AND' | 'OR';

export interface ConversationAutomationFilterTerm {
  type: 'term';
  field: ConversationAutomationFilterField;
  value: string;
}

export interface ConversationAutomationFilterGroup {
  type: 'group';
  operator: ConversationAutomationFilterOperator;
  children: ConversationAutomationFilterNode[];
}

export type ConversationAutomationFilterNode = ConversationAutomationFilterTerm | ConversationAutomationFilterGroup;

export interface ConversationAutomationFilterHelpField {
  key: ConversationAutomationFilterFieldAlias;
  description: string;
  valueHint: string;
  values?: string[];
}

export interface ConversationAutomationFilterHelpTool {
  name: string;
  description: string;
}

export interface ConversationAutomationFilterHelp {
  fields: ConversationAutomationFilterHelpField[];
  examples: string[];
  availableTools: ConversationAutomationFilterHelpTool[];
}

interface Token {
  type: 'word' | 'string' | 'colon' | 'lparen' | 'rparen' | 'and' | 'or';
  value: string;
}

class FilterSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilterSyntaxError';
  }
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function isWordChar(char: string): boolean {
  return /[A-Za-z0-9_.\-/]/.test(char);
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index] ?? '';

    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    if (char === ':') {
      tokens.push({ type: 'colon', value: char });
      index += 1;
      continue;
    }

    if (char === '(') {
      tokens.push({ type: 'lparen', value: char });
      index += 1;
      continue;
    }

    if (char === ')') {
      tokens.push({ type: 'rparen', value: char });
      index += 1;
      continue;
    }

    if (char === '"') {
      let value = '';
      index += 1;
      while (index < input.length) {
        const next = input[index] ?? '';
        if (next === '\\') {
          const escaped = input[index + 1] ?? '';
          if (!escaped) {
            throw new FilterSyntaxError('Unterminated escape in quoted string.');
          }
          value += escaped;
          index += 2;
          continue;
        }
        if (next === '"') {
          index += 1;
          break;
        }
        value += next;
        index += 1;
      }
      if (input[index - 1] !== '"') {
        throw new FilterSyntaxError('Unterminated quoted string.');
      }
      tokens.push({ type: 'string', value });
      continue;
    }

    if (!isWordChar(char)) {
      throw new FilterSyntaxError(`Unexpected character: ${char}`);
    }

    let value = char;
    index += 1;
    while (index < input.length && isWordChar(input[index] ?? '')) {
      value += input[index];
      index += 1;
    }

    const upper = value.toUpperCase();
    if (upper === 'AND') {
      tokens.push({ type: 'and', value: upper });
    } else if (upper === 'OR') {
      tokens.push({ type: 'or', value: upper });
    } else {
      tokens.push({ type: 'word', value });
    }
  }

  return tokens;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): ConversationAutomationFilterNode {
    const expression = this.parseOrExpression();
    if (this.peek()) {
      throw new FilterSyntaxError(`Unexpected token: ${this.peek()?.value}`);
    }
    return expression;
  }

  private parseOrExpression(): ConversationAutomationFilterNode {
    const children = [this.parseAndExpression()];

    while (this.match('or')) {
      children.push(this.parseAndExpression());
    }

    if (children.length === 1) {
      return children[0] as ConversationAutomationFilterNode;
    }

    return {
      type: 'group',
      operator: 'OR',
      children,
    };
  }

  private parseAndExpression(): ConversationAutomationFilterNode {
    const children = [this.parsePrimary()];

    while (this.match('and')) {
      children.push(this.parsePrimary());
    }

    if (children.length === 1) {
      return children[0] as ConversationAutomationFilterNode;
    }

    return {
      type: 'group',
      operator: 'AND',
      children,
    };
  }

  private parsePrimary(): ConversationAutomationFilterNode {
    if (this.match('lparen')) {
      const expression = this.parseOrExpression();
      this.expect('rparen', 'Expected closing parenthesis.');
      return expression;
    }

    return this.parseTerm();
  }

  private parseTerm(): ConversationAutomationFilterTerm {
    const fieldToken = this.expect('word', 'Expected a field name like tool:edit, event:turn_end, repo:personal-agent, or prompt:"...".');
    this.expect('colon', `Expected ':' after ${fieldToken.value}.`);
    const valueToken = this.consume();

    if (!valueToken || (valueToken.type !== 'word' && valueToken.type !== 'string')) {
      throw new FilterSyntaxError(`Expected a value after ${fieldToken.value}:.`);
    }

    const field = fieldToken.value.toLowerCase();
    if (field !== 'tool' && field !== 'event' && field !== 'repo' && field !== 'prompt' && field !== 'judge') {
      throw new FilterSyntaxError(`Unsupported filter key: ${fieldToken.value}.`);
    }

    const value = valueToken.value.trim();
    if (!value) {
      throw new FilterSyntaxError(`Filter ${field}: requires a non-empty value.`);
    }

    return {
      type: 'term',
      field: field === 'judge' ? 'prompt' : field,
      value,
    };
  }

  private expect(type: Token['type'], message: string): Token {
    const token = this.consume();
    if (!token || token.type !== type) {
      throw new FilterSyntaxError(message);
    }
    return token;
  }

  private match(type: Token['type']): boolean {
    if (this.peek()?.type === type) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private consume(): Token | undefined {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }
}

function escapeQuotedValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildLegacyJudgeFilter(prompt: string): string {
  return `prompt:"${escapeQuotedValue(prompt.trim())}"`;
}

export function parseConversationAutomationFilter(input: string): ConversationAutomationFilterNode {
  const normalized = input.trim();
  if (!normalized) {
    throw new FilterSyntaxError('Filter is required.');
  }

  return new Parser(tokenize(normalized)).parse();
}

export function normalizeConversationAutomationFilter(input: string): string {
  const normalized = input.trim();
  if (!normalized) {
    throw new FilterSyntaxError('Filter is required.');
  }

  try {
    parseConversationAutomationFilter(normalized);
    return normalized;
  } catch {
    return buildLegacyJudgeFilter(normalized);
  }
}

export function validateConversationAutomationFilter(
  input: string,
  options: {
    toolNames: Set<string>;
    events?: Set<ConversationAutomationFilterTrigger>;
  },
): ConversationAutomationFilterNode {
  const parsed = parseConversationAutomationFilter(input);

  function validateNode(node: ConversationAutomationFilterNode): void {
    if (node.type === 'group') {
      if (node.children.length === 0) {
        throw new FilterSyntaxError('Filter groups cannot be empty.');
      }
      for (const child of node.children) {
        validateNode(child);
      }
      return;
    }

    if (node.field === 'tool' && !options.toolNames.has(node.value)) {
      throw new FilterSyntaxError(`Unknown tool: ${node.value}.`);
    }

    if (node.field === 'event' && options.events && !options.events.has(node.value as ConversationAutomationFilterTrigger)) {
      throw new FilterSyntaxError(`Unknown event: ${node.value}.`);
    }
  }

  validateNode(parsed);
  return parsed;
}

export function buildConversationAutomationFilterHelp(
  tools: Array<{ name: string; description: string }>,
  events: ConversationAutomationFilterTrigger[] = ['manual', 'turn_end'],
): ConversationAutomationFilterHelp {
  const dedupedTools = new Map<string, ConversationAutomationFilterHelpTool>();

  for (const tool of tools) {
    const name = tool.name.trim();
    if (!name) {
      continue;
    }
    const description = tool.description.trim();
    const current = dedupedTools.get(name);
    if (!current || (!current.description && description)) {
      dedupedTools.set(name, { name, description });
    }
  }

  const availableTools = [...dedupedTools.values()].sort((a, b) => a.name.localeCompare(b.name));
  const sortedTools = availableTools.map((tool) => tool.name);
  const sortedEvents = [...new Set(events)].sort((a, b) => a.localeCompare(b));
  const exampleToolA = sortedTools.includes('edit') ? 'edit' : (sortedTools[0] ?? 'edit');
  const exampleToolB = sortedTools.includes('web_search') ? 'web_search' : (sortedTools[1] ?? exampleToolA);
  const exampleEvent = sortedEvents.includes('turn_end') ? 'turn_end' : (sortedEvents[0] ?? 'turn_end');
  const exampleRepo = 'personal-agent';

  return {
    fields: [
      {
        key: 'event',
        description: 'Exact match on the current automation trigger. Use manual or turn_end.',
        valueHint: 'exact event name',
        values: sortedEvents,
      },
      {
        key: 'tool',
        description: 'Exact match on a tool used in the conversation history.',
        valueHint: 'exact tool name',
        values: sortedTools,
      },
      {
        key: 'repo',
        description: 'Exact match on the basename of the git repository that contains the conversation cwd.',
        valueHint: 'exact git repo name',
      },
      {
        key: 'prompt',
        description: 'Ask the judge model a quoted yes/no question about the visible user/assistant conversation. This is not text search.',
        valueHint: 'quoted judge question',
      },
      {
        key: 'judge',
        description: 'Legacy alias for prompt. Same behavior: it calls the judge model, not a text search.',
        valueHint: 'quoted judge question',
      },
    ],
    examples: [
      `event:${exampleEvent}`,
      `(event:${exampleEvent} AND repo:${exampleRepo}) OR tool:${exampleToolB}`,
      `event:${exampleEvent} AND repo:${exampleRepo} AND tool:${exampleToolA} AND prompt:"Did the assistant already complete the feature?"`,
    ],
    availableTools,
  };
}

function collectUsedToolNames(messages: Array<{ role?: string; content?: unknown }>): Set<string> {
  const toolNames = new Set<string>();

  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      continue;
    }

    for (const block of message.content) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) {
        continue;
      }
      const type = typeof (block as { type?: unknown }).type === 'string' ? (block as { type: string }).type : '';
      if (type !== 'toolCall') {
        continue;
      }
      const toolName = typeof (block as { name?: unknown }).name === 'string'
        ? (block as { name: string }).name.trim()
        : '';
      if (toolName) {
        toolNames.add(toolName);
      }
    }
  }

  return toolNames;
}

export function mayMatchConversationAutomationTrigger(
  input: string,
  trigger: ConversationAutomationFilterTrigger,
): boolean {
  const parsed = parseConversationAutomationFilter(input);

  function nodeMayMatch(node: ConversationAutomationFilterNode): boolean {
    if (node.type === 'term') {
      if (node.field === 'event') {
        return node.value === trigger;
      }
      return true;
    }

    if (node.operator === 'AND') {
      return node.children.every(nodeMayMatch);
    }

    return node.children.some(nodeMayMatch);
  }

  return nodeMayMatch(parsed);
}

function pruneNonDeterministicConversationAutomationFilterNode(
  node: ConversationAutomationFilterNode,
): ConversationAutomationFilterNode | null {
  if (node.type === 'term') {
    return node.field === 'prompt' ? null : node;
  }

  const children = node.children
    .map((child) => pruneNonDeterministicConversationAutomationFilterNode(child))
    .filter((child): child is ConversationAutomationFilterNode => child !== null);

  if (children.length === 0) {
    return null;
  }

  if (children.length === 1) {
    return children[0] ?? null;
  }

  return {
    ...node,
    children,
  };
}

export function previewConversationAutomationFilterDeterministicMatch(
  input: string,
  options: {
    cwd: string;
    messages: Array<{ role?: string; content?: unknown }>;
    toolNames: Set<string>;
    trigger: ConversationAutomationFilterTrigger;
  },
): ConversationAutomationJudgeDecision {
  const parsed = validateConversationAutomationFilter(input, {
    toolNames: options.toolNames,
    events: new Set<ConversationAutomationFilterTrigger>(['manual', 'turn_end']),
  });
  const deterministic = pruneNonDeterministicConversationAutomationFilterNode(parsed);
  if (!deterministic) {
    return {
      pass: false,
      reason: 'No deterministic preview conditions to evaluate.',
      confidence: null,
    };
  }

  const usedToolNames = collectUsedToolNames(options.messages);
  const repo = readGitRepoInfo(options.cwd);

  function evaluateNode(node: ConversationAutomationFilterNode): ConversationAutomationJudgeDecision {
    if (node.type === 'term') {
      if (node.field === 'event') {
        const pass = node.value === options.trigger;
        return {
          pass,
          reason: pass ? `Event ${node.value} matched.` : `Waiting for event ${node.value}.`,
          confidence: null,
        };
      }

      if (node.field === 'tool') {
        const pass = usedToolNames.has(node.value);
        return {
          pass,
          reason: pass ? `Used tool ${node.value}.` : `Tool ${node.value} not used.`,
          confidence: null,
        };
      }

      const pass = repo?.name === node.value;
      return {
        pass,
        reason: pass
          ? `Conversation cwd is inside repo ${node.value}.`
          : repo
            ? `Conversation cwd is inside repo ${repo.name}, not ${node.value}.`
            : `Conversation cwd is not inside git repo ${node.value}.`,
        confidence: null,
      };
    }

    if (node.operator === 'AND') {
      let lastPassing: ConversationAutomationJudgeDecision = {
        pass: true,
        reason: 'All deterministic conditions matched.',
        confidence: null,
      };

      for (const child of node.children) {
        const result = evaluateNode(child);
        if (!result.pass) {
          return result;
        }
        lastPassing = result.reason ? result : lastPassing;
      }

      return lastPassing;
    }

    let firstFailure: ConversationAutomationJudgeDecision | null = null;
    for (const child of node.children) {
      const result = evaluateNode(child);
      if (result.pass) {
        return result;
      }
      firstFailure ??= result;
    }

    return firstFailure ?? {
      pass: false,
      reason: 'No deterministic conditions matched.',
      confidence: null,
    };
  }

  return evaluateNode(deterministic);
}

export async function evaluateConversationAutomationFilter(
  input: string,
  options: {
    cwd: string;
    messages: Array<{ role?: string; content?: unknown }>;
    toolNames: Set<string>;
    modelRegistry: ConversationAutomationJudgeModelRegistry;
    settingsFile: string;
    trigger: ConversationAutomationFilterTrigger;
  },
): Promise<ConversationAutomationJudgeDecision> {
  const parsed = validateConversationAutomationFilter(input, {
    toolNames: options.toolNames,
    events: new Set<ConversationAutomationFilterTrigger>(['manual', 'turn_end']),
  });
  const usedToolNames = collectUsedToolNames(options.messages);
  const repo = readGitRepoInfo(options.cwd);

  async function evaluateNode(node: ConversationAutomationFilterNode): Promise<ConversationAutomationJudgeDecision> {
    if (node.type === 'term') {
      if (node.field === 'event') {
        const pass = node.value === options.trigger;
        return {
          pass,
          reason: pass ? `Event ${node.value} matched.` : `Waiting for event ${node.value}.`,
          confidence: null,
        };
      }

      if (node.field === 'tool') {
        const pass = usedToolNames.has(node.value);
        return {
          pass,
          reason: pass ? `Used tool ${node.value}.` : `Tool ${node.value} not used.`,
          confidence: null,
        };
      }

      if (node.field === 'repo') {
        const pass = repo?.name === node.value;
        return {
          pass,
          reason: pass
            ? `Conversation cwd is inside repo ${node.value}.`
            : repo
              ? `Conversation cwd is inside repo ${repo.name}, not ${node.value}.`
              : `Conversation cwd is not inside git repo ${node.value}.`,
          confidence: null,
        };
      }

      return runConversationAutomationJudge({
        prompt: node.value,
        messages: options.messages,
        modelRegistry: options.modelRegistry,
        settingsFile: options.settingsFile,
      });
    }

    if (node.operator === 'AND') {
      let lastPassing: ConversationAutomationJudgeDecision = {
        pass: true,
        reason: 'All conditions matched.',
        confidence: null,
      };

      for (const child of node.children) {
        const result = await evaluateNode(child);
        if (!result.pass) {
          return result;
        }
        lastPassing = result.confidence !== null || result.reason ? result : lastPassing;
      }

      return lastPassing;
    }

    let firstFailure: ConversationAutomationJudgeDecision | null = null;
    for (const child of node.children) {
      const result = await evaluateNode(child);
      if (result.pass) {
        return result;
      }
      firstFailure ??= result;
    }

    return firstFailure ?? {
      pass: false,
      reason: 'No conditions matched.',
      confidence: null,
    };
  }

  return evaluateNode(parsed);
}
