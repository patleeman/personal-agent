import {
  createMemoryDoc,
  filterMemoryDocs,
  lintMemoryDocs,
  loadMemoryDocs,
  normalizeCsvValues,
  resolveMemoryDocById,
  validateMemoryDocId,
} from '@personal-agent/core';
import { bullet, dim, formatHint, keyValue, printDenseCommandList, printDenseUsage, section, success, warning } from './ui.js';

function noteUsageText(): string {
  return 'Usage: pa note [list|find|show|new|lint] [args...]';
}

function noteListUsageText(): string {
  return 'Usage: pa note list [--json]';
}

function noteFindUsageText(): string {
  return 'Usage: pa note find [--type <type>] [--status <status>] [--area <area>] [--role <role>] [--parent <id>] [--text <query>] [--json]';
}

function noteShowUsageText(): string {
  return 'Usage: pa note show <id> [--json]';
}

function noteNewUsageText(): string {
  return 'Usage: pa note new <id> --title <title> --summary <summary> [--type <type>] [--status <status>] [--area <area>] [--role <role>] [--parent <id>] [--related <id1,id2>] [--force] [--json]';
}

function noteLintUsageText(): string {
  return 'Usage: pa note lint [--json]';
}

function formatNoteRelated(related: string[]): string {
  return related.length > 0 ? related.map((value) => `@${value}`).join(', ') : 'none';
}

function isNoteHelpToken(value: string | undefined): boolean {
  return value === 'help' || value === '--help' || value === '-h';
}

function printNoteHelp(): void {
  console.log('Note');
  console.log('');
  printDenseUsage('pa note [list|find|show|new|lint|help]');
  console.log('');
  printDenseCommandList('Commands', [
    { usage: 'list [--json]', description: 'List parsed shared note nodes' },
    { usage: 'find [--type <type>] [--status <status>] [--area <area>] [--role <role>] [--parent <id>] [--text <query>] [--json]', description: 'Filter shared note nodes by metadata fields' },
    { usage: 'show <id> [--json]', description: 'Show one note node and metadata' },
    { usage: 'new <id> --title <title> --summary <summary> [--type <type>] [--status <status>] [--area <area>] [--role <role>] [--parent <id>] [--related <id1,id2>] [--force] [--json]', description: 'Create a new shared note node scaffold with INDEX.md frontmatter' },
    { usage: 'lint [--json]', description: 'Validate shared note node frontmatter, duplicate ids, and broken note links' },
    { usage: 'help', description: 'Show note help' },
  ]);
}

export async function noteCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    printNoteHelp();
    return 0;
  }

  if (isNoteHelpToken(subcommand)) {
    if (rest.length > 0) {
      throw new Error(noteUsageText());
    }

    printNoteHelp();
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

      throw new Error(noteListUsageText());
    }

    const loaded = loadMemoryDocs();
    const payload = {
      noteDir: loaded.memoryDir,
      docs: loaded.docs,
      parseErrors: loaded.parseErrors,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return loaded.parseErrors.length > 0 ? 1 : 0;
    }

    console.log(section('Note nodes'));
    console.log(keyValue('Notes dir', loaded.memoryDir));

    if (loaded.docs.length === 0) {
      console.log(dim('No note nodes found.'));
    }

    for (const doc of loaded.docs) {
      console.log('');
      console.log(bullet(`${doc.id}: ${doc.title}`));
      console.log(keyValue('Type', doc.type, 4));
      console.log(keyValue('Status', doc.status, 4));
      if (doc.area) console.log(keyValue('Area', doc.area, 4));
      if (doc.role) console.log(keyValue('Role', doc.role, 4));
      if (doc.parent) console.log(keyValue('Parent', `@${doc.parent}`, 4));
      if (doc.related.length > 0) console.log(keyValue('Related', formatNoteRelated(doc.related), 4));
      console.log(keyValue('Updated', doc.updated, 4));
      console.log(keyValue('Summary', doc.summary, 4));
      console.log(keyValue('File', doc.filePath, 4));
    }

    if (loaded.parseErrors.length > 0) {
      console.log('');
      console.log(warning(`${loaded.parseErrors.length} note node(s) failed to parse`));
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
    let areaFilter: string | undefined;
    let roleFilter: string | undefined;
    let parentFilter: string | undefined;
    let textFilter: string | undefined;

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;

      if (arg === '--json') {
        jsonMode = true;
        continue;
      }

      if (arg === '--type') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(noteFindUsageText());
        }

        typeFilter = value.trim().toLowerCase();
        index += 1;
        continue;
      }

      if (arg.startsWith('--type=')) {
        const value = arg.slice('--type='.length).trim();
        if (value.length === 0) {
          throw new Error(noteFindUsageText());
        }

        typeFilter = value.toLowerCase();
        continue;
      }

      if (arg === '--status') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(noteFindUsageText());
        }

        statusFilter = value.trim().toLowerCase();
        index += 1;
        continue;
      }

      if (arg.startsWith('--status=')) {
        const value = arg.slice('--status='.length).trim();
        if (value.length === 0) {
          throw new Error(noteFindUsageText());
        }

        statusFilter = value.toLowerCase();
        continue;
      }

      if (arg === '--area') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) throw new Error(noteFindUsageText());
        areaFilter = value.trim().toLowerCase();
        index += 1;
        continue;
      }

      if (arg.startsWith('--area=')) {
        const value = arg.slice('--area='.length).trim();
        if (value.length === 0) throw new Error(noteFindUsageText());
        areaFilter = value.toLowerCase();
        continue;
      }

      if (arg === '--role') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) throw new Error(noteFindUsageText());
        roleFilter = value.trim().toLowerCase();
        index += 1;
        continue;
      }

      if (arg.startsWith('--role=')) {
        const value = arg.slice('--role='.length).trim();
        if (value.length === 0) throw new Error(noteFindUsageText());
        roleFilter = value.toLowerCase();
        continue;
      }

      if (arg === '--parent') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) throw new Error(noteFindUsageText());
        parentFilter = value.trim().toLowerCase();
        index += 1;
        continue;
      }

      if (arg.startsWith('--parent=')) {
        const value = arg.slice('--parent='.length).trim();
        if (value.length === 0) throw new Error(noteFindUsageText());
        parentFilter = value.toLowerCase();
        continue;
      }

      if (arg === '--text') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(noteFindUsageText());
        }

        textFilter = value.trim().toLowerCase();
        index += 1;
        continue;
      }

      if (arg.startsWith('--text=')) {
        const value = arg.slice('--text='.length).trim();
        if (value.length === 0) {
          throw new Error(noteFindUsageText());
        }

        textFilter = value.toLowerCase();
        continue;
      }

      throw new Error(noteFindUsageText());
    }

    const loaded = loadMemoryDocs();
    const filteredDocs = filterMemoryDocs(loaded.docs, {
      type: typeFilter,
      status: statusFilter,
      area: areaFilter,
      role: roleFilter,
      parent: parentFilter,
      text: textFilter,
    });

    const payload = {
      noteDir: loaded.memoryDir,
      filters: {
        type: typeFilter ?? null,
        status: statusFilter ?? null,
        area: areaFilter ?? null,
        role: roleFilter ?? null,
        parent: parentFilter ?? null,
        text: textFilter ?? null,
      },
      docs: filteredDocs,
      parseErrors: loaded.parseErrors,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return loaded.parseErrors.length > 0 ? 1 : 0;
    }

    console.log(section('Note node search'));
    console.log(keyValue('Notes dir', loaded.memoryDir));
    console.log(keyValue('Type filter', typeFilter ?? 'none'));
    console.log(keyValue('Status filter', statusFilter ?? 'none'));
    console.log(keyValue('Area filter', areaFilter ?? 'none'));
    console.log(keyValue('Role filter', roleFilter ?? 'none'));
    console.log(keyValue('Parent filter', parentFilter ?? 'none'));
    console.log(keyValue('Text filter', textFilter ?? 'none'));

    if (filteredDocs.length === 0) {
      console.log(dim('No note nodes matched the supplied filters.'));
    }

    for (const doc of filteredDocs) {
      console.log('');
      console.log(bullet(`${doc.id}: ${doc.title}`));
      console.log(keyValue('Type', doc.type, 4));
      console.log(keyValue('Status', doc.status, 4));
      if (doc.area) console.log(keyValue('Area', doc.area, 4));
      if (doc.role) console.log(keyValue('Role', doc.role, 4));
      if (doc.parent) console.log(keyValue('Parent', `@${doc.parent}`, 4));
      if (doc.related.length > 0) console.log(keyValue('Related', formatNoteRelated(doc.related), 4));
      console.log(keyValue('Updated', doc.updated, 4));
      console.log(keyValue('Summary', doc.summary, 4));
      console.log(keyValue('File', doc.filePath, 4));
    }

    if (loaded.parseErrors.length > 0) {
      console.log('');
      console.log(warning(`${loaded.parseErrors.length} note node(s) failed to parse`));
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
        throw new Error(noteShowUsageText());
      }

      positional.push(arg);
    }

    if (positional.length !== 1) {
      throw new Error(noteShowUsageText());
    }

    const loaded = loadMemoryDocs();
    const doc = resolveMemoryDocById(loaded.docs, positional[0] as string);

    const payload = {
      noteDir: loaded.memoryDir,
      doc,
      parseErrors: loaded.parseErrors,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return loaded.parseErrors.length > 0 ? 1 : 0;
    }

    console.log(section(`Note node: ${doc.id}`));
    console.log(keyValue('Title', doc.title));
    console.log(keyValue('Type', doc.type));
    console.log(keyValue('Status', doc.status));
    if (doc.area) console.log(keyValue('Area', doc.area));
    if (doc.role) console.log(keyValue('Role', doc.role));
    if (doc.parent) console.log(keyValue('Parent', `@${doc.parent}`));
    if (doc.related.length > 0) console.log(keyValue('Related', formatNoteRelated(doc.related)));
    console.log(keyValue('Updated', doc.updated));
    console.log(keyValue('Summary', doc.summary));
    console.log(keyValue('File', doc.filePath));

    console.log('');
    console.log(section('Body'));
    console.log(doc.body);

    if (loaded.parseErrors.length > 0) {
      console.log('');
      console.log(warning(`${loaded.parseErrors.length} note node(s) failed to parse`));
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
    let area: string | undefined;
    let role: string | undefined;
    let parent: string | undefined;
    const rawRelatedValues: string[] = [];
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
          throw new Error(noteNewUsageText());
        }

        title = value.trim();
        index += 1;
        continue;
      }

      if (arg.startsWith('--title=')) {
        const value = arg.slice('--title='.length).trim();
        if (value.length === 0) {
          throw new Error(noteNewUsageText());
        }

        title = value;
        continue;
      }

      if (arg === '--summary') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(noteNewUsageText());
        }

        summary = value.trim();
        index += 1;
        continue;
      }

      if (arg.startsWith('--summary=')) {
        const value = arg.slice('--summary='.length).trim();
        if (value.length === 0) {
          throw new Error(noteNewUsageText());
        }

        summary = value;
        continue;
      }

      if (arg === '--type') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(noteNewUsageText());
        }

        type = value.trim();
        index += 1;
        continue;
      }

      if (arg.startsWith('--type=')) {
        const value = arg.slice('--type='.length).trim();
        if (value.length === 0) {
          throw new Error(noteNewUsageText());
        }

        type = value;
        continue;
      }

      if (arg === '--status') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(noteNewUsageText());
        }

        status = value.trim();
        index += 1;
        continue;
      }

      if (arg.startsWith('--status=')) {
        const value = arg.slice('--status='.length).trim();
        if (value.length === 0) {
          throw new Error(noteNewUsageText());
        }

        status = value;
        continue;
      }

      if (arg === '--area') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) throw new Error(noteNewUsageText());
        area = value.trim();
        index += 1;
        continue;
      }

      if (arg.startsWith('--area=')) {
        const value = arg.slice('--area='.length).trim();
        if (value.length === 0) throw new Error(noteNewUsageText());
        area = value;
        continue;
      }

      if (arg === '--role') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) throw new Error(noteNewUsageText());
        role = value.trim();
        index += 1;
        continue;
      }

      if (arg.startsWith('--role=')) {
        const value = arg.slice('--role='.length).trim();
        if (value.length === 0) throw new Error(noteNewUsageText());
        role = value;
        continue;
      }

      if (arg === '--parent') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) throw new Error(noteNewUsageText());
        parent = value.trim();
        index += 1;
        continue;
      }

      if (arg.startsWith('--parent=')) {
        const value = arg.slice('--parent='.length).trim();
        if (value.length === 0) throw new Error(noteNewUsageText());
        parent = value;
        continue;
      }

      if (arg === '--related') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) throw new Error(noteNewUsageText());
        rawRelatedValues.push(value.trim());
        index += 1;
        continue;
      }

      if (arg.startsWith('--related=')) {
        const value = arg.slice('--related='.length).trim();
        if (value.length === 0) throw new Error(noteNewUsageText());
        rawRelatedValues.push(value);
        continue;
      }

      if (arg.startsWith('-')) {
        throw new Error(noteNewUsageText());
      }

      positional.push(arg);
    }

    if (positional.length !== 1) {
      throw new Error(noteNewUsageText());
    }

    if (!title || title.length === 0 || !summary || summary.length === 0) {
      throw new Error(noteNewUsageText());
    }

    const id = (positional[0] as string).trim();
    validateMemoryDocId(id);

    const related = normalizeCsvValues(rawRelatedValues);

    const payload = createMemoryDoc({
      id,
      title,
      summary,
      type,
      status,
      area,
      role,
      parent,
      related,
      force,
    });

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return 0;
    }

    console.log(section(`Note node ${payload.overwritten ? 'updated' : 'created'}`));
    console.log(keyValue('ID', payload.id));
    console.log(keyValue('File', payload.filePath));
    console.log(keyValue('Type', payload.type));
    console.log(keyValue('Status', payload.status));
    if (payload.area) console.log(keyValue('Area', payload.area));
    if (payload.role) console.log(keyValue('Role', payload.role));
    if (payload.parent) console.log(keyValue('Parent', `@${payload.parent}`));
    if (payload.related.length > 0) console.log(keyValue('Related', formatNoteRelated(payload.related)));
    console.log(keyValue('Updated', payload.updated));

    console.log('');
    console.log(success(`Note node ${payload.overwritten ? 'updated' : 'created'}:`, payload.id));
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

      throw new Error(noteLintUsageText());
    }

    const result = lintMemoryDocs();
    const payload = {
      ...result,
      noteDir: result.memoryDir,
    };
    const hasIssues = payload.parseErrors.length > 0 || payload.duplicateIds.length > 0 || payload.referenceErrors.length > 0;

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return hasIssues ? 1 : 0;
    }

    console.log(section('Note node validation'));
    console.log(keyValue('Notes dir', payload.noteDir));
    console.log(keyValue('Docs parsed', payload.validDocs));
    console.log(keyValue('Parse errors', payload.parseErrors.length));
    console.log(keyValue('Duplicate ids', payload.duplicateIds.length));
    console.log(keyValue('Reference errors', payload.referenceErrors.length));

    if (!hasIssues) {
      console.log('');
      console.log(success('All note nodes are valid'));
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

    if (payload.referenceErrors.length > 0) {
      console.log('');
      console.log(warning('Broken note references'));
      for (const issue of payload.referenceErrors) {
        console.log(keyValue('Reference', `${issue.id}.${issue.field} -> ${issue.targetId}: ${issue.error} (${issue.filePath})`, 4));
      }
    }

    return 1;
  }

  throw new Error(`${noteUsageText()}\nUnknown note subcommand: ${subcommand}`);
}
