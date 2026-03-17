import {
  createMemoryDoc,
  filterMemoryDocs,
  lintMemoryDocs,
  loadMemoryDocs,
  resolveMemoryDocById,
  splitMemoryTagValues,
  validateMemoryDocId,
} from '@personal-agent/core';
import { bullet, dim, formatHint, keyValue, section, success, warning } from './ui.js';

function memoryUsageText(): string {
  return 'Usage: pa memory [list|find|show|new|lint] [args...]';
}

function memoryListUsageText(): string {
  return 'Usage: pa memory list [--json]';
}

function memoryFindUsageText(): string {
  return 'Usage: pa memory find [--tag <tag>] [--type <type>] [--status <status>] [--text <query>] [--json]';
}

function memoryShowUsageText(): string {
  return 'Usage: pa memory show <id> [--json]';
}

function memoryNewUsageText(): string {
  return 'Usage: pa memory new <id> --title <title> --summary <summary> --tags <tag1,tag2> [--type <type>] [--status <status>] [--force] [--json]';
}

function memoryLintUsageText(): string {
  return 'Usage: pa memory lint [--json]';
}

function formatMemoryTags(tags: string[]): string {
  return tags.length > 0 ? tags.join(', ') : 'none';
}

function isMemoryHelpToken(value: string | undefined): boolean {
  return value === 'help' || value === '--help' || value === '-h';
}

function printMemoryHelp(): void {
  console.log(section('Memory commands'));
  console.log('');
  console.log(`Usage: pa memory [list|find|show|new|lint|help]

Commands:
  list [--json]
                           List parsed global memory docs
  find [--tag <tag>] [--type <type>] [--status <status>] [--text <query>] [--json]
                           Filter global memory docs by metadata fields
  show <id> [--json]
                           Show one memory doc and metadata
  new <id> --title <title> --summary <summary> --tags <tag1,tag2> [--type <type>] [--status <status>] [--force] [--json]
                           Create a new global memory doc template with YAML frontmatter
  lint [--json]
                           Validate global memory doc frontmatter and duplicate ids
  help                     Show memory help
`);
}

export async function memoryCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    printMemoryHelp();
    return 0;
  }

  if (isMemoryHelpToken(subcommand)) {
    if (rest.length > 0) {
      throw new Error(memoryUsageText());
    }

    printMemoryHelp();
    return 0;
  }

  if (subcommand === 'list') {
    let jsonMode = false;

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;
      if (arg === '--json') {
        jsonMode = true;
        continue;
      }

      throw new Error(memoryListUsageText());
    }

    const loaded = loadMemoryDocs();
    const payload = {
      memoryDir: loaded.memoryDir,
      docs: loaded.docs,
      parseErrors: loaded.parseErrors,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return loaded.parseErrors.length > 0 ? 1 : 0;
    }

    console.log(section('Memory docs'));
    console.log(keyValue('Memory dir', loaded.memoryDir));

    if (loaded.docs.length === 0) {
      console.log(dim('No memory docs found.'));
    }

    for (const doc of loaded.docs) {
      console.log('');
      console.log(bullet(`${doc.id}: ${doc.title}`));
      console.log(keyValue('Type', doc.type, 4));
      console.log(keyValue('Status', doc.status, 4));
      console.log(keyValue('Updated', doc.updated, 4));
      console.log(keyValue('Tags', formatMemoryTags(doc.tags), 4));
      console.log(keyValue('Summary', doc.summary, 4));
      console.log(keyValue('File', doc.filePath, 4));
    }

    if (loaded.parseErrors.length > 0) {
      console.log('');
      console.log(warning(`${loaded.parseErrors.length} memory doc(s) failed to parse`));
      for (const issue of loaded.parseErrors) {
        console.log(keyValue('Parse error', `${issue.filePath}: ${issue.error}`, 4));
      }
    }

    return loaded.parseErrors.length > 0 ? 1 : 0;
  }

  if (subcommand === 'find') {
    let jsonMode = false;
    let typeFilter: string | undefined;
    let statusFilter: string | undefined;
    let textFilter: string | undefined;
    const tagFilters: string[] = [];

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;

      if (arg === '--json') {
        jsonMode = true;
        continue;
      }

      if (arg === '--tag') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryFindUsageText());
        }

        tagFilters.push(value.trim().toLowerCase());
        index += 1;
        continue;
      }

      if (arg.startsWith('--tag=')) {
        const value = arg.slice('--tag='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryFindUsageText());
        }

        tagFilters.push(value.toLowerCase());
        continue;
      }

      if (arg === '--type') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryFindUsageText());
        }

        typeFilter = value.trim().toLowerCase();
        index += 1;
        continue;
      }

      if (arg.startsWith('--type=')) {
        const value = arg.slice('--type='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryFindUsageText());
        }

        typeFilter = value.toLowerCase();
        continue;
      }

      if (arg === '--status') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryFindUsageText());
        }

        statusFilter = value.trim().toLowerCase();
        index += 1;
        continue;
      }

      if (arg.startsWith('--status=')) {
        const value = arg.slice('--status='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryFindUsageText());
        }

        statusFilter = value.toLowerCase();
        continue;
      }

      if (arg === '--text') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryFindUsageText());
        }

        textFilter = value.trim().toLowerCase();
        index += 1;
        continue;
      }

      if (arg.startsWith('--text=')) {
        const value = arg.slice('--text='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryFindUsageText());
        }

        textFilter = value.toLowerCase();
        continue;
      }

      throw new Error(memoryFindUsageText());
    }

    const loaded = loadMemoryDocs();
    const filteredDocs = filterMemoryDocs(loaded.docs, {
      tags: tagFilters,
      type: typeFilter,
      status: statusFilter,
      text: textFilter,
    });

    const payload = {
      memoryDir: loaded.memoryDir,
      filters: {
        tags: tagFilters,
        type: typeFilter ?? null,
        status: statusFilter ?? null,
        text: textFilter ?? null,
      },
      docs: filteredDocs,
      parseErrors: loaded.parseErrors,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return loaded.parseErrors.length > 0 ? 1 : 0;
    }

    console.log(section('Memory doc search'));
    console.log(keyValue('Memory dir', loaded.memoryDir));
    console.log(keyValue('Tag filters', tagFilters.length > 0 ? tagFilters.join(', ') : 'none'));
    console.log(keyValue('Type filter', typeFilter ?? 'none'));
    console.log(keyValue('Status filter', statusFilter ?? 'none'));
    console.log(keyValue('Text filter', textFilter ?? 'none'));

    if (filteredDocs.length === 0) {
      console.log(dim('No memory docs matched the supplied filters.'));
    }

    for (const doc of filteredDocs) {
      console.log('');
      console.log(bullet(`${doc.id}: ${doc.title}`));
      console.log(keyValue('Type', doc.type, 4));
      console.log(keyValue('Status', doc.status, 4));
      console.log(keyValue('Updated', doc.updated, 4));
      console.log(keyValue('Tags', formatMemoryTags(doc.tags), 4));
      console.log(keyValue('Summary', doc.summary, 4));
      console.log(keyValue('File', doc.filePath, 4));
    }

    if (loaded.parseErrors.length > 0) {
      console.log('');
      console.log(warning(`${loaded.parseErrors.length} memory doc(s) failed to parse`));
      for (const issue of loaded.parseErrors) {
        console.log(keyValue('Parse error', `${issue.filePath}: ${issue.error}`, 4));
      }
    }

    return loaded.parseErrors.length > 0 ? 1 : 0;
  }

  if (subcommand === 'show') {
    let jsonMode = false;
    const positional: string[] = [];

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;

      if (arg === '--json') {
        jsonMode = true;
        continue;
      }

      if (arg.startsWith('-')) {
        throw new Error(memoryShowUsageText());
      }

      positional.push(arg);
    }

    if (positional.length !== 1) {
      throw new Error(memoryShowUsageText());
    }

    const loaded = loadMemoryDocs();
    const doc = resolveMemoryDocById(loaded.docs, positional[0] as string);

    const payload = {
      memoryDir: loaded.memoryDir,
      doc,
      parseErrors: loaded.parseErrors,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return loaded.parseErrors.length > 0 ? 1 : 0;
    }

    console.log(section(`Memory doc: ${doc.id}`));
    console.log(keyValue('Title', doc.title));
    console.log(keyValue('Type', doc.type));
    console.log(keyValue('Status', doc.status));
    console.log(keyValue('Updated', doc.updated));
    console.log(keyValue('Tags', formatMemoryTags(doc.tags)));
    console.log(keyValue('Summary', doc.summary));
    console.log(keyValue('File', doc.filePath));

    console.log('');
    console.log(section('Body'));
    console.log(doc.body);

    if (loaded.parseErrors.length > 0) {
      console.log('');
      console.log(warning(`${loaded.parseErrors.length} memory doc(s) failed to parse`));
      for (const issue of loaded.parseErrors) {
        console.log(keyValue('Parse error', `${issue.filePath}: ${issue.error}`, 4));
      }
    }

    return loaded.parseErrors.length > 0 ? 1 : 0;
  }

  if (subcommand === 'new') {
    let jsonMode = false;
    let force = false;
    let title: string | undefined;
    let summary: string | undefined;
    let type = 'note';
    let status = 'active';
    const rawTagValues: string[] = [];
    const positional: string[] = [];

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;

      if (arg === '--json') {
        jsonMode = true;
        continue;
      }

      if (arg === '--force') {
        force = true;
        continue;
      }

      if (arg === '--title') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryNewUsageText());
        }

        title = value.trim();
        index += 1;
        continue;
      }

      if (arg.startsWith('--title=')) {
        const value = arg.slice('--title='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryNewUsageText());
        }

        title = value;
        continue;
      }

      if (arg === '--summary') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryNewUsageText());
        }

        summary = value.trim();
        index += 1;
        continue;
      }

      if (arg.startsWith('--summary=')) {
        const value = arg.slice('--summary='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryNewUsageText());
        }

        summary = value;
        continue;
      }

      if (arg === '--type') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryNewUsageText());
        }

        type = value.trim();
        index += 1;
        continue;
      }

      if (arg.startsWith('--type=')) {
        const value = arg.slice('--type='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryNewUsageText());
        }

        type = value;
        continue;
      }

      if (arg === '--status') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryNewUsageText());
        }

        status = value.trim();
        index += 1;
        continue;
      }

      if (arg.startsWith('--status=')) {
        const value = arg.slice('--status='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryNewUsageText());
        }

        status = value;
        continue;
      }

      if (arg === '--tags' || arg === '--tag') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryNewUsageText());
        }

        rawTagValues.push(value.trim());
        index += 1;
        continue;
      }

      if (arg.startsWith('--tags=')) {
        const value = arg.slice('--tags='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryNewUsageText());
        }

        rawTagValues.push(value);
        continue;
      }

      if (arg.startsWith('--tag=')) {
        const value = arg.slice('--tag='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryNewUsageText());
        }

        rawTagValues.push(value);
        continue;
      }

      if (arg.startsWith('-')) {
        throw new Error(memoryNewUsageText());
      }

      positional.push(arg);
    }

    if (positional.length !== 1) {
      throw new Error(memoryNewUsageText());
    }

    if (!title || title.length === 0 || !summary || summary.length === 0) {
      throw new Error(memoryNewUsageText());
    }

    const id = (positional[0] as string).trim();
    validateMemoryDocId(id);

    const tags = splitMemoryTagValues(rawTagValues);
    if (tags.length === 0) {
      throw new Error(memoryNewUsageText());
    }

    const payload = createMemoryDoc({
      id,
      title,
      summary,
      type,
      status,
      tags,
      force,
    });

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return 0;
    }

    console.log(section(`Memory doc ${payload.overwritten ? 'updated' : 'created'}`));
    console.log(keyValue('ID', payload.id));
    console.log(keyValue('File', payload.filePath));
    console.log(keyValue('Type', payload.type));
    console.log(keyValue('Status', payload.status));
    console.log(keyValue('Tags', formatMemoryTags(payload.tags)));
    console.log(keyValue('Updated', payload.updated));

    console.log('');
    console.log(success(`Memory doc ${payload.overwritten ? 'updated' : 'created'}:`, payload.id));
    console.log(`  ${formatHint(`Edit ${payload.filePath} to add details`)}`);
    return 0;
  }

  if (subcommand === 'lint') {
    let jsonMode = false;

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;
      if (arg === '--json') {
        jsonMode = true;
        continue;
      }

      throw new Error(memoryLintUsageText());
    }

    const payload = lintMemoryDocs();
    const hasIssues = payload.parseErrors.length > 0 || payload.duplicateIds.length > 0;

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return hasIssues ? 1 : 0;
    }

    console.log(section('Memory validation'));
    console.log(keyValue('Memory dir', payload.memoryDir));
    console.log(keyValue('Docs parsed', payload.validDocs));
    console.log(keyValue('Parse errors', payload.parseErrors.length));
    console.log(keyValue('Duplicate ids', payload.duplicateIds.length));

    if (!hasIssues) {
      console.log('');
      console.log(success('All memory docs are valid'));
      return 0;
    }

    if (payload.parseErrors.length > 0) {
      console.log('');
      console.log(warning('Parse errors'));
      for (const issue of payload.parseErrors) {
        console.log(keyValue('Parse error', `${issue.filePath}: ${issue.error}`, 4));
      }
    }

    if (payload.duplicateIds.length > 0) {
      console.log('');
      console.log(warning('Duplicate ids'));
      for (const duplicate of payload.duplicateIds) {
        console.log(keyValue('Duplicate', `${duplicate.id} -> ${duplicate.files.join(', ')}`, 4));
      }
    }

    return 1;
  }

  throw new Error(`${memoryUsageText()}\nUnknown memory subcommand: ${subcommand}`);
}
