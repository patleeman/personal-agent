import {
  createUnifiedNode,
  deleteUnifiedNode,
  findUnifiedNodeById,
  findUnifiedNodes,
  lintUnifiedNodes,
  loadUnifiedNodes,
  migrateLegacyNodes,
  normalizeCsvValues,
  tagUnifiedNode,
  updateUnifiedNode,
  validateUnifiedNodeId,
} from '@personal-agent/core';
import { bullet, dim, formatHint, keyValue, printDenseCommandList, printDenseUsage, section, success, warning } from './ui.js';

type UnifiedStoreCommandConfig = {
  commandName: 'node' | 'page';
  title: 'Node' | 'Page';
  singular: 'node' | 'page';
  plural: 'nodes' | 'pages';
};

const NODE_COMMAND_CONFIG: UnifiedStoreCommandConfig = {
  commandName: 'node',
  title: 'Node',
  singular: 'node',
  plural: 'nodes',
};

const PAGE_COMMAND_CONFIG: UnifiedStoreCommandConfig = {
  commandName: 'page',
  title: 'Page',
  singular: 'page',
  plural: 'pages',
};

function usageText(config: UnifiedStoreCommandConfig): string {
  return `Usage: pa ${config.commandName} [list|find|show|get|new|update|delete|tag|lint|migrate|help] [args...]`;
}

function subcommandUsage(config: UnifiedStoreCommandConfig, subcommand: string, rest: string): string {
  return `Usage: pa ${config.commandName} ${subcommand}${rest}`;
}

function isHelpToken(value: string | undefined): boolean {
  return value === 'help' || value === '--help' || value === '-h';
}

function printHelp(config: UnifiedStoreCommandConfig): void {
  console.log(config.title);
  console.log('');
  printDenseUsage(`pa ${config.commandName} [list|find|show|get|new|update|delete|tag|lint|migrate|help]`);
  console.log('');
  printDenseCommandList('Commands', [
    { usage: 'list [--query <expr>] [--json]', description: `List unified durable ${config.plural}` },
    { usage: 'find <query> [--json]', description: `Search ${config.plural} with tag + full-text query syntax` },
    { usage: 'show <id> [--json]', description: `Show one ${config.singular} with parsed metadata` },
    { usage: 'get <id> [--json]', description: `Show one ${config.singular} without extra formatting` },
    { usage: 'new <id> --title <title> --summary <summary> [--description <text>] [--status <status>] [--tag <key:value>] [--parent <id>] [--related <id1,id2>] [--body <markdown>] [--force] [--json]', description: `Create a unified ${config.singular} scaffold` },
    { usage: 'update <id> [--title <title>] [--summary <summary>] [--description <text>] [--status <status>] [--add-tag <key:value>] [--remove-tag <key:value>] [--parent <id>] [--clear-parent] [--related <id1,id2>] [--body <markdown>] [--json]', description: `Update ${config.singular} metadata, tags, and body` },
    { usage: 'delete <id> [--json]', description: `Delete a unified ${config.singular}` },
    { usage: 'tag <id> [--add <key:value>] [--remove <key:value>] [--json]', description: `Add or remove ${config.singular} tags` },
    { usage: 'lint [--json]', description: `Validate ${config.singular} frontmatter, duplicate ids, and references` },
    { usage: 'migrate [--json]', description: 'Copy legacy notes, skills, and projects into /sync/nodes' },
    { usage: 'help', description: `Show ${config.commandName} help` },
  ]);
}

function formatRelated(related: string[]): string {
  return related.length > 0 ? related.map((value) => `@${value}`).join(', ') : 'none';
}

function formatTags(tags: string[]): string {
  return tags.length > 0 ? tags.join(', ') : 'none';
}

function printItemSummary(item: {
  id: string;
  title: string;
  summary: string;
  status: string;
  kinds: string[];
  tags: string[];
  updatedAt?: string;
  filePath: string;
}): void {
  console.log(bullet(`${item.id}: ${item.title}`));
  console.log(keyValue('Types', item.kinds.join(', '), 4));
  console.log(keyValue('Status', item.status, 4));
  console.log(keyValue('Tags', formatTags(item.tags), 4));
  if (item.updatedAt) {
    console.log(keyValue('Updated', item.updatedAt, 4));
  }
  console.log(keyValue('Summary', item.summary, 4));
  console.log(keyValue('File', item.filePath, 4));
}

async function runUnifiedStoreCommand(args: string[], config: UnifiedStoreCommandConfig): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    printHelp(config);
    return 0;
  }

  if (isHelpToken(subcommand)) {
    if (rest.length > 0) {
      throw new Error(usageText(config));
    }
    printHelp(config);
    return 0;
  }

  if (subcommand === 'list') {
    let jsonMode = false;
    let query: string | undefined;

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;
      if (arg === '--json') {
        jsonMode = true;
        continue;
      }
      if (arg === '--query') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(subcommandUsage(config, 'list', ' [--query <expr>] [--json]'));
        }
        query = value;
        index += 1;
        continue;
      }
      if (arg.startsWith('--query=')) {
        query = arg.slice('--query='.length).trim();
        continue;
      }
      throw new Error(subcommandUsage(config, 'list', ' [--query <expr>] [--json]'));
    }

    const loaded = loadUnifiedNodes();
    const nodes = findUnifiedNodes(loaded.nodes, query);
    const payload = { nodesDir: loaded.nodesDir, query: query ?? null, nodes, parseErrors: loaded.parseErrors };
    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return loaded.parseErrors.length > 0 ? 1 : 0;
    }

    console.log(section(`Unified ${config.plural}`));
    console.log(keyValue('Nodes dir', loaded.nodesDir));
    console.log(keyValue('Query', query ?? 'none'));
    if (nodes.length === 0) {
      console.log(dim(`No unified ${config.plural} matched.`));
    }
    for (const node of nodes) {
      console.log('');
      printItemSummary(node);
    }
    if (loaded.parseErrors.length > 0) {
      console.log('');
      console.log(warning(`${loaded.parseErrors.length} ${config.singular}(s) failed to parse`));
      for (const issue of loaded.parseErrors) {
        console.log(keyValue('Parse error', `${issue.filePath}: ${issue.error}`, 4));
      }
    }
    return loaded.parseErrors.length > 0 ? 1 : 0;
  }

  if (subcommand === 'find') {
    let jsonMode = false;
    const positional: string[] = [];
    for (const arg of rest) {
      if (arg === '--json') {
        jsonMode = true;
        continue;
      }
      positional.push(arg);
    }
    if (positional.length === 0) {
      throw new Error(subcommandUsage(config, 'find', ' <query> [--json]'));
    }
    const query = positional.join(' ');
    const loaded = loadUnifiedNodes();
    const nodes = findUnifiedNodes(loaded.nodes, query);
    const payload = { nodesDir: loaded.nodesDir, query, nodes, parseErrors: loaded.parseErrors };
    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return loaded.parseErrors.length > 0 ? 1 : 0;
    }
    console.log(section(`Unified ${config.singular} search`));
    console.log(keyValue('Nodes dir', loaded.nodesDir));
    console.log(keyValue('Query', query));
    if (nodes.length === 0) {
      console.log(dim(`No unified ${config.plural} matched the supplied query.`));
    }
    for (const node of nodes) {
      console.log('');
      printItemSummary(node);
    }
    return loaded.parseErrors.length > 0 ? 1 : 0;
  }

  if (subcommand === 'show' || subcommand === 'get') {
    let jsonMode = false;
    const positional: string[] = [];
    for (const arg of rest) {
      if (arg === '--json') {
        jsonMode = true;
        continue;
      }
      positional.push(arg);
    }
    if (positional.length !== 1) {
      throw new Error(subcommandUsage(config, subcommand, ' <id> [--json]'));
    }
    const loaded = loadUnifiedNodes();
    const node = findUnifiedNodeById(loaded.nodes, positional[0] as string);
    const payload = { nodesDir: loaded.nodesDir, node, parseErrors: loaded.parseErrors };
    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return loaded.parseErrors.length > 0 ? 1 : 0;
    }

    console.log(section(`Unified ${config.singular}: ${node.id}`));
    console.log(keyValue('Title', node.title));
    console.log(keyValue('Types', node.kinds.join(', ')));
    console.log(keyValue('Status', node.status));
    console.log(keyValue('Tags', formatTags(node.tags)));
    if (node.links.parent) console.log(keyValue('Parent', `@${node.links.parent}`));
    if (node.links.related.length > 0) console.log(keyValue('Related', formatRelated(node.links.related)));
    if (node.updatedAt) console.log(keyValue('Updated', node.updatedAt));
    console.log(keyValue('Summary', node.summary));
    console.log(keyValue('File', node.filePath));
    console.log('');
    console.log(section('Body'));
    console.log(node.body);
    return loaded.parseErrors.length > 0 ? 1 : 0;
  }

  if (subcommand === 'new') {
    let jsonMode = false;
    let force = false;
    let title: string | undefined;
    let summary: string | undefined;
    let description: string | undefined;
    let status: string | undefined;
    let body: string | undefined;
    let parent: string | undefined;
    const rawTags: string[] = [];
    const rawRelated: string[] = [];
    const positional: string[] = [];

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;
      if (arg === '--json') { jsonMode = true; continue; }
      if (arg === '--force') { force = true; continue; }
      if (arg === '--title' || arg.startsWith('--title=')) {
        title = arg === '--title' ? rest[index + 1] : arg.slice('--title='.length);
        if (arg === '--title') index += 1;
        continue;
      }
      if (arg === '--summary' || arg.startsWith('--summary=')) {
        summary = arg === '--summary' ? rest[index + 1] : arg.slice('--summary='.length);
        if (arg === '--summary') index += 1;
        continue;
      }
      if (arg === '--description' || arg.startsWith('--description=')) {
        description = arg === '--description' ? rest[index + 1] : arg.slice('--description='.length);
        if (arg === '--description') index += 1;
        continue;
      }
      if (arg === '--status' || arg.startsWith('--status=')) {
        status = arg === '--status' ? rest[index + 1] : arg.slice('--status='.length);
        if (arg === '--status') index += 1;
        continue;
      }
      if (arg === '--body' || arg.startsWith('--body=')) {
        body = arg === '--body' ? rest[index + 1] : arg.slice('--body='.length);
        if (arg === '--body') index += 1;
        continue;
      }
      if (arg === '--tag' || arg.startsWith('--tag=')) {
        rawTags.push(arg === '--tag' ? String(rest[index + 1] ?? '') : arg.slice('--tag='.length));
        if (arg === '--tag') index += 1;
        continue;
      }
      if (arg === '--parent' || arg.startsWith('--parent=')) {
        parent = arg === '--parent' ? rest[index + 1] : arg.slice('--parent='.length);
        if (arg === '--parent') index += 1;
        continue;
      }
      if (arg === '--related' || arg.startsWith('--related=')) {
        rawRelated.push(arg === '--related' ? String(rest[index + 1] ?? '') : arg.slice('--related='.length));
        if (arg === '--related') index += 1;
        continue;
      }
      if (arg.startsWith('-')) {
        throw new Error(subcommandUsage(config, 'new', ' <id> --title <title> --summary <summary> [--description <text>] [--status <status>] [--tag <key:value>] [--parent <id>] [--related <id1,id2>] [--body <markdown>] [--force] [--json]'));
      }
      positional.push(arg);
    }

    if (positional.length !== 1 || !title?.trim() || !summary?.trim()) {
      throw new Error(subcommandUsage(config, 'new', ' <id> --title <title> --summary <summary> [--description <text>] [--status <status>] [--tag <key:value>] [--parent <id>] [--related <id1,id2>] [--body <markdown>] [--force] [--json]'));
    }

    const id = positional[0] as string;
    validateUnifiedNodeId(id.trim().toLowerCase());
    const result = createUnifiedNode({
      id,
      title,
      summary,
      description,
      status,
      body,
      parent,
      related: normalizeCsvValues(rawRelated),
      tags: normalizeCsvValues(rawTags),
      force,
    });
    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }

    console.log(section(`Unified ${config.singular} ${result.overwritten ? 'updated' : 'created'}`));
    printItemSummary(result.node);
    console.log('');
    console.log(success(`Unified ${config.singular} ${result.overwritten ? 'updated' : 'created'}:`, result.node.id));
    console.log(`  ${formatHint(`Edit ${result.node.filePath} to add details`)}`);
    return 0;
  }

  if (subcommand === 'update') {
    let jsonMode = false;
    let title: string | undefined;
    let summary: string | undefined;
    let description: string | undefined;
    let clearDescription = false;
    let status: string | undefined;
    let body: string | undefined;
    let parent: string | undefined;
    let clearParent = false;
    const addTags: string[] = [];
    const removeTags: string[] = [];
    const rawRelated: string[] = [];
    const positional: string[] = [];

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;
      if (arg === '--json') { jsonMode = true; continue; }
      if (arg === '--clear-description') { clearDescription = true; continue; }
      if (arg === '--clear-parent') { clearParent = true; continue; }
      if (arg === '--title' || arg.startsWith('--title=')) { title = arg === '--title' ? rest[index + 1] : arg.slice('--title='.length); if (arg === '--title') index += 1; continue; }
      if (arg === '--summary' || arg.startsWith('--summary=')) { summary = arg === '--summary' ? rest[index + 1] : arg.slice('--summary='.length); if (arg === '--summary') index += 1; continue; }
      if (arg === '--description' || arg.startsWith('--description=')) { description = arg === '--description' ? rest[index + 1] : arg.slice('--description='.length); if (arg === '--description') index += 1; continue; }
      if (arg === '--status' || arg.startsWith('--status=')) { status = arg === '--status' ? rest[index + 1] : arg.slice('--status='.length); if (arg === '--status') index += 1; continue; }
      if (arg === '--body' || arg.startsWith('--body=')) { body = arg === '--body' ? rest[index + 1] : arg.slice('--body='.length); if (arg === '--body') index += 1; continue; }
      if (arg === '--parent' || arg.startsWith('--parent=')) { parent = arg === '--parent' ? rest[index + 1] : arg.slice('--parent='.length); if (arg === '--parent') index += 1; continue; }
      if (arg === '--related' || arg.startsWith('--related=')) { rawRelated.push(arg === '--related' ? String(rest[index + 1] ?? '') : arg.slice('--related='.length)); if (arg === '--related') index += 1; continue; }
      if (arg === '--add-tag' || arg.startsWith('--add-tag=')) { addTags.push(arg === '--add-tag' ? String(rest[index + 1] ?? '') : arg.slice('--add-tag='.length)); if (arg === '--add-tag') index += 1; continue; }
      if (arg === '--remove-tag' || arg.startsWith('--remove-tag=')) { removeTags.push(arg === '--remove-tag' ? String(rest[index + 1] ?? '') : arg.slice('--remove-tag='.length)); if (arg === '--remove-tag') index += 1; continue; }
      if (arg.startsWith('-')) throw new Error(subcommandUsage(config, 'update', ' <id> [--title <title>] [--summary <summary>] [--description <text>] [--status <status>] [--add-tag <key:value>] [--remove-tag <key:value>] [--parent <id>] [--clear-parent] [--related <id1,id2>] [--body <markdown>] [--json]'));
      positional.push(arg);
    }

    if (positional.length !== 1) {
      throw new Error(subcommandUsage(config, 'update', ' <id> [--title <title>] [--summary <summary>] [--description <text>] [--status <status>] [--add-tag <key:value>] [--remove-tag <key:value>] [--parent <id>] [--clear-parent] [--related <id1,id2>] [--body <markdown>] [--json]'));
    }

    const node = updateUnifiedNode({
      id: positional[0] as string,
      title,
      summary,
      description: clearDescription ? null : description,
      status,
      body,
      parent: clearParent ? null : parent,
      related: rawRelated.length > 0 ? normalizeCsvValues(rawRelated) : undefined,
      addTags: normalizeCsvValues(addTags),
      removeTags: normalizeCsvValues(removeTags),
    });
    if (jsonMode) {
      console.log(JSON.stringify({ node }, null, 2));
      return 0;
    }
    console.log(section(`Unified ${config.singular} updated`));
    printItemSummary(node);
    return 0;
  }

  if (subcommand === 'delete') {
    let jsonMode = false;
    const positional: string[] = [];
    for (const arg of rest) {
      if (arg === '--json') { jsonMode = true; continue; }
      positional.push(arg);
    }
    if (positional.length !== 1) {
      throw new Error(subcommandUsage(config, 'delete', ' <id> [--json]'));
    }
    const result = deleteUnifiedNode(positional[0] as string);
    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    console.log(success(`Deleted unified ${config.singular}:`, result.id));
    return 0;
  }

  if (subcommand === 'tag') {
    let jsonMode = false;
    const add: string[] = [];
    const remove: string[] = [];
    const positional: string[] = [];
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;
      if (arg === '--json') { jsonMode = true; continue; }
      if (arg === '--add' || arg.startsWith('--add=')) { add.push(arg === '--add' ? String(rest[index + 1] ?? '') : arg.slice('--add='.length)); if (arg === '--add') index += 1; continue; }
      if (arg === '--remove' || arg.startsWith('--remove=')) { remove.push(arg === '--remove' ? String(rest[index + 1] ?? '') : arg.slice('--remove='.length)); if (arg === '--remove') index += 1; continue; }
      if (arg.startsWith('-')) throw new Error(subcommandUsage(config, 'tag', ' <id> [--add <key:value>] [--remove <key:value>] [--json]'));
      positional.push(arg);
    }
    if (positional.length !== 1) {
      throw new Error(subcommandUsage(config, 'tag', ' <id> [--add <key:value>] [--remove <key:value>] [--json]'));
    }
    const node = tagUnifiedNode({ id: positional[0] as string, add: normalizeCsvValues(add), remove: normalizeCsvValues(remove) });
    if (jsonMode) {
      console.log(JSON.stringify({ node }, null, 2));
      return 0;
    }
    console.log(section(`Unified ${config.singular} retagged`));
    printItemSummary(node);
    return 0;
  }

  if (subcommand === 'lint') {
    let jsonMode = false;
    for (const arg of rest) {
      if (arg === '--json') { jsonMode = true; continue; }
      throw new Error(subcommandUsage(config, 'lint', ' [--json]'));
    }
    const result = lintUnifiedNodes();
    const hasIssues = result.parseErrors.length > 0 || result.duplicateIds.length > 0 || result.referenceErrors.length > 0;
    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
      return hasIssues ? 1 : 0;
    }
    console.log(section(`Unified ${config.singular} validation`));
    console.log(keyValue('Nodes dir', result.nodesDir));
    console.log(keyValue('Nodes parsed', result.validNodes));
    console.log(keyValue('Parse errors', result.parseErrors.length));
    console.log(keyValue('Duplicate ids', result.duplicateIds.length));
    console.log(keyValue('Reference errors', result.referenceErrors.length));
    if (!hasIssues) {
      console.log('');
      console.log(success(`All unified ${config.plural} are valid`));
      return 0;
    }
    if (result.parseErrors.length > 0) {
      console.log('');
      console.log(warning('Parse errors'));
      for (const issue of result.parseErrors) {
        console.log(keyValue('Parse error', `${issue.filePath}: ${issue.error}`, 4));
      }
    }
    if (result.duplicateIds.length > 0) {
      console.log('');
      console.log(warning('Duplicate ids'));
      for (const duplicate of result.duplicateIds) {
        console.log(keyValue('Duplicate', `${duplicate.id} -> ${duplicate.files.join(', ')}`, 4));
      }
    }
    if (result.referenceErrors.length > 0) {
      console.log('');
      console.log(warning('Broken references'));
      for (const issue of result.referenceErrors) {
        console.log(keyValue('Reference', `${issue.id}.${issue.field} -> ${issue.targetId}: ${issue.error} (${issue.filePath})`, 4));
      }
    }
    return 1;
  }

  if (subcommand === 'migrate') {
    let jsonMode = false;
    for (const arg of rest) {
      if (arg === '--json') { jsonMode = true; continue; }
      throw new Error(subcommandUsage(config, 'migrate', ' [--json]'));
    }
    const result = migrateLegacyNodes();
    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    console.log(section(`Legacy ${config.singular} migration`));
    console.log(keyValue('Nodes dir', result.nodesDir));
    console.log(keyValue('Created', result.created.length));
    console.log(keyValue('Updated', result.updated.length));
    console.log(keyValue('Skipped', result.skipped.length));
    console.log(keyValue('Conflicts', result.conflicts.length));
    if (result.created.length > 0) console.log(keyValue('Created ids', result.created.join(', '), 4));
    if (result.updated.length > 0) console.log(keyValue('Updated ids', result.updated.join(', '), 4));
    if (result.conflicts.length > 0) {
      console.log('');
      console.log(warning('Merged collisions'));
      for (const conflict of result.conflicts) {
        console.log(keyValue('Conflict', `${conflict.id} (${conflict.kinds.join(', ')})`, 4));
      }
    }
    return 0;
  }

  throw new Error(`${usageText(config)}\nUnknown ${config.commandName} subcommand: ${subcommand}`);
}

export async function nodeCommand(args: string[]): Promise<number> {
  return runUnifiedStoreCommand(args, NODE_COMMAND_CONFIG);
}

export async function pageCommand(args: string[]): Promise<number> {
  return runUnifiedStoreCommand(args, PAGE_COMMAND_CONFIG);
}
