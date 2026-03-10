import { basename, dirname, join, relative, resolve } from 'node:path';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DynamicBorder } from '@mariozechner/pi-coding-agent';
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { Container, type SelectItem, SelectList, Text } from '@mariozechner/pi-tui';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const MEMORY_STATUS_KEY = 'memory-browser';

export interface MemoryProfileLayer {
  name: string;
  agentDir: string;
}

export interface MemoryProfileContext {
  cwd: string;
  repoRoot: string;
  requestedProfile: string;
  activeProfile: string;
  activeProfileDir: string;
  layers: MemoryProfileLayer[];
  activeAgentsFile?: string;
  activeSkillsDir: string;
  activeTasksDir?: string;
  activeMemoryDir?: string;
}

export interface MemoryBrowserMenu {
  title: string;
  subtitle?: string;
  emptyMessage?: string;
  items: MemoryBrowserItem[];
}

export interface MemoryBrowserFileItem {
  kind: 'file';
  id: string;
  label: string;
  description?: string;
  path: string;
}

export interface MemoryBrowserMenuItem {
  kind: 'menu';
  id: string;
  label: string;
  description?: string;
  buildMenu: () => MemoryBrowserMenu;
}

export type MemoryBrowserItem = MemoryBrowserFileItem | MemoryBrowserMenuItem;

type MemoryMenuSelection = MemoryBrowserItem | 'back' | 'noop' | undefined;

function sanitizeProfileName(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  const normalized = raw.trim();
  if (!PROFILE_NAME_PATTERN.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function resolveRepoRoot(): string {
  const explicit = process.env.PERSONAL_AGENT_REPO_ROOT?.trim();
  if (explicit && explicit.length > 0) {
    return resolve(explicit);
  }

  const extensionDir = dirname(fileURLToPath(import.meta.url));
  return resolve(extensionDir, '../../../../..');
}

function resolveRequestedProfile(): string {
  const envCandidates = [
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE,
    process.env.PERSONAL_AGENT_PROFILE,
  ];

  for (const candidate of envCandidates) {
    const sanitized = sanitizeProfileName(candidate);
    if (sanitized) {
      return sanitized;
    }
  }

  return 'shared';
}

function resolveProfileDir(repoRoot: string, profile: string): string {
  return join(repoRoot, 'profiles', profile, 'agent');
}

function toDisplayPath(cwd: string, path: string): string {
  const displayed = relative(cwd, path);
  if (!displayed || displayed.startsWith('..')) {
    return path;
  }

  return displayed.replace(/\\/g, '/');
}

export function resolveMemoryProfileContext(cwd: string): MemoryProfileContext {
  const repoRoot = resolveRepoRoot();
  const requestedProfile = resolveRequestedProfile();
  const requestedProfileDir = resolveProfileDir(repoRoot, requestedProfile);
  const sharedProfileDir = resolveProfileDir(repoRoot, 'shared');

  const activeProfile = existsSync(requestedProfileDir) ? requestedProfile : 'shared';
  const activeProfileDir = activeProfile === requestedProfile
    ? requestedProfileDir
    : sharedProfileDir;

  const layers: MemoryProfileLayer[] = [
    { name: 'shared', agentDir: sharedProfileDir },
  ];

  if (activeProfile !== 'shared') {
    layers.push({ name: activeProfile, agentDir: activeProfileDir });
  }

  return {
    cwd,
    repoRoot,
    requestedProfile,
    activeProfile,
    activeProfileDir,
    layers,
    activeAgentsFile: activeProfile === 'shared'
      ? undefined
      : join(activeProfileDir, 'AGENTS.md'),
    activeSkillsDir: join(activeProfileDir, 'skills'),
    activeTasksDir: activeProfile === 'shared'
      ? undefined
      : join(activeProfileDir, 'tasks'),
    activeMemoryDir: activeProfile === 'shared'
      ? undefined
      : join(activeProfileDir, 'memory'),
  };
}

function buildMemoryPolicyBlock(options: {
  cwd: string;
  repoRoot: string;
  requestedProfile: string;
  activeProfile: string;
  activeProfileDir: string;
  activeAgentsFile?: string;
  activeSkillsDir: string;
  activeTasksDir?: string;
  activeMemoryDir?: string;
}): string {
  const activeProfileDirDisplay = toDisplayPath(options.cwd, options.activeProfileDir);
  const repoRootDisplay = toDisplayPath(options.cwd, options.repoRoot);
  const activeAgentsTarget = options.activeAgentsFile
    ? toDisplayPath(options.cwd, options.activeAgentsFile)
    : 'none (shared profile does not use AGENTS.md)';
  const activeSkillsDirDisplay = toDisplayPath(options.cwd, options.activeSkillsDir);
  const activeTasksDirDisplay = options.activeTasksDir
    ? toDisplayPath(options.cwd, options.activeTasksDir)
    : 'none (shared profile does not use profile task dir)';

  const requestedProfileSection = options.requestedProfile !== options.activeProfile
    ? `- requested_profile: ${options.requestedProfile}\n- note: requested profile was missing; using "${options.activeProfile}"\n`
    : '';

  const memorySection = options.activeMemoryDir
    ? `- Memory dir: ${toDisplayPath(options.cwd, options.activeMemoryDir)}\n- Memory doc template: ${toDisplayPath(options.cwd, join(options.activeMemoryDir, '<doc-id>.md'))}`
    : '- Memory dir: none (shared profile has no memory dir)';

  const memoryRetrievalSection = options.activeMemoryDir
    ? `- At task start, apply the active AGENTS policy first, then load only the skills and memory docs relevant to the current request.\n- Retrieval order: AGENTS.md for durable policy/facts, skills for reusable workflows/tactics, memory docs for profile/project context.\n- Prefer targeted retrieval over broad scans; do not read the whole memory directory unless the task genuinely requires it.\n- Prefer \`pa memory list --profile ${options.activeProfile}\` to inventory available memory docs.\n- Prefer \`pa memory find --profile ${options.activeProfile} --text <query>\` and/or \`--tag\`, \`--type\`, \`--status\` to locate relevant docs quickly.\n- Use \`pa memory show <id> --profile ${options.activeProfile}\` to inspect a specific memory doc by id.\n- Use CLI discovery first, then use the read tool on the exact file before editing.\n- Use \`pa memory new <id> --profile ${options.activeProfile} ...\` to create a new memory doc with valid frontmatter when needed.\n- Use \`pa memory lint --profile ${options.activeProfile}\` after creating or heavily editing memory docs.`
    : `- At task start, apply the active AGENTS policy first, then load only the skills relevant to the current request.\n- Retrieval order: AGENTS.md for durable policy/facts, then skills for reusable workflows/tactics.\n- Shared profile has no profile-local memory docs.`;

  const docsDirDisplay = toDisplayPath(options.cwd, join(options.repoRoot, 'docs'));
  const docsIndexDisplay = toDisplayPath(options.cwd, join(options.repoRoot, 'docs', 'README.md'));

  return `MEMORY_POLICY

## Active profile context
- active_profile: ${options.activeProfile}
- active_profile_dir: ${activeProfileDirDisplay}
- repo_root: ${repoRootDisplay}
${requestedProfileSection}
## Profile memory write targets
Profile memory write targets (edit these locations directly):
- AGENTS.md edit target: ${activeAgentsTarget}
- Skills dir: ${activeSkillsDirDisplay}
- Scheduled tasks dir: ${activeTasksDirDisplay}
- Scheduled tasks should live adjacent to memory (not inside memory).
${memorySection}

## PA documentation
PA documentation (read when the user asks about pa/personal-agent, CLI, daemon, gateway, tasks, profiles, or extensions):
- Docs folder: ${docsDirDisplay}
- Start with docs index: ${docsIndexDisplay}
- Then follow markdown cross-references to relevant pages.
- When working on personal-agent features, read relevant docs first before implementing.

## Durable memory policy
Use profile-local AGENTS.md, skills, and memory docs as the durable memory system.

## Memory handling rules
Memory handling rules:
- When asked to update durable behavior/memory, edit the AGENTS.md edit target above.
- AGENTS.md should stay high-level: user facts, durable role constraints, and broad operating policies.
- Store stable behavior rules, durable facts, and role constraints in AGENTS.md.
- Do not put tool/version-specific tactics, temporary issue notes, or narrow workflows in AGENTS.md.
- Store reusable cross-project workflows and domain knowledge in skills.
- Skills are for workflows and tactics you expect to repeat.
- Put tool-specific runbooks and version-specific quirks in skills (for example Task Factory behavior notes).
- Store profile-specific briefs, runbooks, specs, and notes under memory/*.md with YAML frontmatter.
- Keep memory docs flat (single folder) for predictable retrieval.
${memoryRetrievalSection}
- Keep non-markdown automation state outside memory docs (for example under agent/state/).
- If AGENTS.md contains narrow operational details, migrate them to skills/memory docs and simplify AGENTS.md.
- Do not write durable memory into profiles/shared/agent/AGENTS.md.
- Do not use MEMORY.md files as durable memory.
- Never store secrets, credentials, API keys, tokens, or temporary/session-only notes.
- Read the workflow-learn-skill and workflow-skill-creator skills when creating new skills.`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripYamlScalar(raw: string): string {
  const trimmed = raw.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function extractFrontmatterValue(content: string, key: string): string | undefined {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return undefined;
  }

  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return undefined;
  }

  const frontmatter = normalized.slice(4, end);
  const match = frontmatter.match(new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, 'm'));
  if (!match) {
    return undefined;
  }

  return stripYamlScalar(match[1] ?? '');
}

function formatCount(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

function shouldHideBrowserEntry(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules';
}

function countVisibleDirectoryEntries(dirPath: string): number {
  if (!existsSync(dirPath)) {
    return 0;
  }

  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => !shouldHideBrowserEntry(entry.name))
      .length;
  } catch {
    return 0;
  }
}

function compareDirectoryEntries(a: { name: string; isDirectory(): boolean }, b: { name: string; isDirectory(): boolean }): number {
  if (a.isDirectory() !== b.isDirectory()) {
    return a.isDirectory() ? -1 : 1;
  }

  if (!a.isDirectory() && !b.isDirectory()) {
    if (a.name === 'SKILL.md' && b.name !== 'SKILL.md') {
      return -1;
    }

    if (b.name === 'SKILL.md' && a.name !== 'SKILL.md') {
      return 1;
    }
  }

  return a.name.localeCompare(b.name);
}

function readTextFile(path: string): string {
  const buffer = readFileSync(path);
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));

  for (const byte of sample) {
    if (byte === 0) {
      throw new Error(`Binary file is not supported: ${path}`);
    }
  }

  return buffer.toString('utf-8');
}

function listAgentFiles(context: MemoryProfileContext): MemoryBrowserFileItem[] {
  const items: MemoryBrowserFileItem[] = [];

  for (const layer of context.layers) {
    const filePath = join(layer.agentDir, 'AGENTS.md');
    if (!existsSync(filePath)) {
      continue;
    }

    items.push({
      kind: 'file',
      id: `agents:${layer.name}`,
      label: layer.name,
      description: toDisplayPath(context.cwd, filePath),
      path: filePath,
    });
  }

  return items;
}

interface SkillDirectoryMeta {
  label: string;
  description?: string;
  path: string;
}

function getSkillDirectoryMeta(skillDir: string): SkillDirectoryMeta {
  const skillFile = join(skillDir, 'SKILL.md');
  const defaultLabel = basename(skillDir);

  if (!existsSync(skillFile)) {
    return {
      label: defaultLabel,
      path: skillDir,
    };
  }

  try {
    const content = readFileSync(skillFile, 'utf-8');
    return {
      label: extractFrontmatterValue(content, 'name') ?? defaultLabel,
      description: extractFrontmatterValue(content, 'description') ?? undefined,
      path: skillDir,
    };
  } catch {
    return {
      label: defaultLabel,
      path: skillDir,
    };
  }
}

function listSkillDirectories(layer: MemoryProfileLayer): SkillDirectoryMeta[] {
  const skillsDir = join(layer.agentDir, 'skills');
  if (!existsSync(skillsDir)) {
    return [];
  }

  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !shouldHideBrowserEntry(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => getSkillDirectoryMeta(join(skillsDir, entry.name)));
  } catch {
    return [];
  }
}

function buildDirectoryMenu(title: string, dirPath: string, cwd: string, subtitle?: string): MemoryBrowserMenu {
  if (!existsSync(dirPath)) {
    return {
      title,
      subtitle,
      emptyMessage: `${toDisplayPath(cwd, dirPath)} does not exist.`,
      items: [],
    };
  }

  let directoryEntries: Array<ReturnType<typeof readdirSync>[number]> = [];
  try {
    directoryEntries = readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => !shouldHideBrowserEntry(entry.name))
      .sort(compareDirectoryEntries);
  } catch {
    return {
      title,
      subtitle,
      emptyMessage: `Could not read ${toDisplayPath(cwd, dirPath)}.`,
      items: [],
    };
  }

  const items: MemoryBrowserItem[] = directoryEntries.map((entry) => {
    const fullPath = join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const childCount = countVisibleDirectoryEntries(fullPath);
      return {
        kind: 'menu',
        id: `menu:${fullPath}`,
        label: entry.name,
        description: `${formatCount(childCount, 'item')} • ${toDisplayPath(cwd, fullPath)}`,
        buildMenu: () => buildDirectoryMenu(entry.name, fullPath, cwd, toDisplayPath(cwd, fullPath)),
      } satisfies MemoryBrowserMenuItem;
    }

    return {
      kind: 'file',
      id: `file:${fullPath}`,
      label: entry.name,
      description: toDisplayPath(cwd, fullPath),
      path: fullPath,
    } satisfies MemoryBrowserFileItem;
  });

  return {
    title,
    subtitle,
    emptyMessage: `No files in ${toDisplayPath(cwd, dirPath)}.`,
    items,
  };
}

function buildSkillLayerMenu(layer: MemoryProfileLayer, context: MemoryProfileContext): MemoryBrowserMenu {
  const skills = listSkillDirectories(layer);
  const skillsDir = join(layer.agentDir, 'skills');

  return {
    title: `${layer.name} skills`,
    subtitle: toDisplayPath(context.cwd, skillsDir),
    emptyMessage: `No skill folders in ${toDisplayPath(context.cwd, skillsDir)}.`,
    items: skills.map((skill) => ({
      kind: 'menu',
      id: `skill:${layer.name}:${skill.path}`,
      label: skill.label,
      description: skill.description ?? toDisplayPath(context.cwd, skill.path),
      buildMenu: () => buildDirectoryMenu(
        `Skill — ${skill.label}`,
        skill.path,
        context.cwd,
        `${layer.name} • ${toDisplayPath(context.cwd, skill.path)}`,
      ),
    })),
  };
}

function buildSkillsMenu(context: MemoryProfileContext): MemoryBrowserMenu {
  return {
    title: 'Skills',
    subtitle: `Layered skills for ${context.activeProfile}`,
    emptyMessage: 'No skill layers are available.',
    items: context.layers.map((layer) => {
      const skillCount = listSkillDirectories(layer).length;
      const skillsDir = join(layer.agentDir, 'skills');

      return {
        kind: 'menu',
        id: `skills-layer:${layer.name}`,
        label: layer.name,
        description: `${formatCount(skillCount, 'skill folder')} • ${toDisplayPath(context.cwd, skillsDir)}`,
        buildMenu: () => buildSkillLayerMenu(layer, context),
      } satisfies MemoryBrowserMenuItem;
    }),
  };
}

function buildMemoriesMenu(context: MemoryProfileContext): MemoryBrowserMenu {
  if (!context.activeMemoryDir) {
    return {
      title: 'Memories folder',
      subtitle: 'Shared profile has no profile-local memory directory.',
      emptyMessage: 'No profile-local memory docs are available for the shared profile.',
      items: [],
    };
  }

  if (!existsSync(context.activeMemoryDir)) {
    return {
      title: 'Memories folder',
      subtitle: toDisplayPath(context.cwd, context.activeMemoryDir),
      emptyMessage: `${toDisplayPath(context.cwd, context.activeMemoryDir)} does not exist.`,
      items: [],
    };
  }

  let directoryEntries: Array<ReturnType<typeof readdirSync>[number]> = [];
  try {
    directoryEntries = readdirSync(context.activeMemoryDir, { withFileTypes: true })
      .filter((entry) => !shouldHideBrowserEntry(entry.name))
      .sort(compareDirectoryEntries);
  } catch {
    return {
      title: 'Memories folder',
      subtitle: toDisplayPath(context.cwd, context.activeMemoryDir),
      emptyMessage: `Could not read ${toDisplayPath(context.cwd, context.activeMemoryDir)}.`,
      items: [],
    };
  }

  const items: MemoryBrowserItem[] = directoryEntries.map((entry) => {
    const fullPath = join(context.activeMemoryDir!, entry.name);

    if (entry.isDirectory()) {
      const childCount = countVisibleDirectoryEntries(fullPath);
      return {
        kind: 'menu',
        id: `memory-dir:${fullPath}`,
        label: entry.name,
        description: `${formatCount(childCount, 'item')} • ${toDisplayPath(context.cwd, fullPath)}`,
        buildMenu: () => buildDirectoryMenu(entry.name, fullPath, context.cwd, toDisplayPath(context.cwd, fullPath)),
      } satisfies MemoryBrowserMenuItem;
    }

    let label = entry.name;
    let description = toDisplayPath(context.cwd, fullPath);

    try {
      const content = readFileSync(fullPath, 'utf-8');
      label = extractFrontmatterValue(content, 'title') ?? label;
      description = extractFrontmatterValue(content, 'summary') ?? description;
    } catch {
      // fall back to filename/path
    }

    return {
      kind: 'file',
      id: `memory-file:${fullPath}`,
      label,
      description,
      path: fullPath,
    } satisfies MemoryBrowserFileItem;
  });

  return {
    title: 'Memories folder',
    subtitle: toDisplayPath(context.cwd, context.activeMemoryDir),
    emptyMessage: `No memory docs in ${toDisplayPath(context.cwd, context.activeMemoryDir)}.`,
    items,
  };
}

function buildAgentsMenu(context: MemoryProfileContext): MemoryBrowserMenu {
  const items = listAgentFiles(context);

  return {
    title: 'AGENTS.md',
    subtitle: 'Layered AGENTS sources used by personal-agent.',
    emptyMessage: 'No AGENTS.md files were found for the current layers.',
    items,
  };
}

export function buildMemoryBrowserRootMenu(context: MemoryProfileContext): MemoryBrowserMenu {
  const agentCount = listAgentFiles(context).length;
  const skillCount = context.layers.reduce((total, layer) => total + listSkillDirectories(layer).length, 0);
  const memoryCount = context.activeMemoryDir && existsSync(context.activeMemoryDir)
    ? readdirSync(context.activeMemoryDir, { withFileTypes: true })
      .filter((entry) => !shouldHideBrowserEntry(entry.name))
      .length
    : 0;

  const subtitle = context.requestedProfile === context.activeProfile
    ? `Active profile: ${context.activeProfile}`
    : `Active profile: ${context.activeProfile} (requested ${context.requestedProfile})`;

  return {
    title: 'Memory',
    subtitle,
    items: [
      {
        kind: 'menu',
        id: 'root:skills',
        label: 'Skills',
        description: `${formatCount(skillCount, 'skill folder')} across ${formatCount(context.layers.length, 'layer')}`,
        buildMenu: () => buildSkillsMenu(context),
      },
      {
        kind: 'menu',
        id: 'root:memory',
        label: 'Memories folder',
        description: context.activeMemoryDir
          ? `${formatCount(memoryCount, 'item')} • ${toDisplayPath(context.cwd, context.activeMemoryDir)}`
          : 'Shared profile has no profile-local memory directory',
        buildMenu: () => buildMemoriesMenu(context),
      },
      {
        kind: 'menu',
        id: 'root:agents',
        label: 'AGENTS.md',
        description: formatCount(agentCount, 'file'),
        buildMenu: () => buildAgentsMenu(context),
      },
    ],
  };
}

function applyMemoryStatus(ctx: ExtensionContext): void {
  if (!ctx.hasUI) {
    return;
  }

  ctx.ui.setStatus(MEMORY_STATUS_KEY, ctx.ui.theme.fg('dim', '🧠 /memory'));
}

async function showMemoryMenu(
  ctx: ExtensionContext,
  menu: MemoryBrowserMenu,
  canGoBack: boolean,
): Promise<MemoryMenuSelection> {
  const valueToItem = new Map<string, MemoryBrowserItem>();
  const selectItems: SelectItem[] = [];

  if (canGoBack) {
    selectItems.push({
      value: '__back',
      label: '← Back',
      description: 'Return to the previous section',
    });
  }

  for (const item of menu.items) {
    const label = item.kind === 'menu' ? `${item.label}/` : item.label;
    const description = item.description;
    valueToItem.set(item.id, item);
    selectItems.push({
      value: item.id,
      label,
      description,
    });
  }

  if (menu.items.length === 0) {
    selectItems.push({
      value: '__noop',
      label: '(no entries)',
      description: menu.emptyMessage ?? 'No items available.',
    });
  }

  const result = await ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((text: string) => theme.fg('accent', text)));
    container.addChild(new Text(theme.fg('accent', theme.bold(menu.title)), 1, 0));

    if (menu.subtitle) {
      container.addChild(new Text(theme.fg('muted', menu.subtitle), 1, 0));
    }

    if (menu.items.length === 0 && menu.emptyMessage) {
      container.addChild(new Text(theme.fg('warning', menu.emptyMessage), 1, 0));
    }

    const selectList = new SelectList(selectItems, Math.min(Math.max(selectItems.length, 1), 14), {
      selectedPrefix: (text) => theme.fg('accent', text),
      selectedText: (text) => theme.fg('accent', text),
      description: (text) => theme.fg('muted', text),
      scrollInfo: (text) => theme.fg('dim', text),
      noMatch: (text) => theme.fg('warning', text),
    });

    selectList.onSelect = (item) => done(item.value);
    selectList.onCancel = () => done(undefined);

    container.addChild(selectList);

    const hints = canGoBack
      ? '↑↓ navigate • enter inspect/edit • esc close • ← Back'
      : '↑↓ navigate • enter inspect/edit • esc close';
    container.addChild(new Text(theme.fg('dim', hints), 1, 0));
    container.addChild(new DynamicBorder((text: string) => theme.fg('accent', text)));

    return {
      render(width: number) {
        return container.render(width);
      },
      invalidate() {
        container.invalidate();
      },
      handleInput(data: string) {
        selectList.handleInput?.(data);
        tui.requestRender();
      },
    };
  }, {
    overlay: true,
    overlayOptions: {
      anchor: 'right-center',
      width: '45%',
      minWidth: 48,
      maxWidth: 96,
      maxHeight: '85%',
      margin: 1,
    },
  });

  if (result === undefined) {
    return undefined;
  }

  if (result === '__back') {
    return 'back';
  }

  if (result === '__noop') {
    return 'noop';
  }

  return valueToItem.get(result);
}

async function inspectOrEditMemoryFile(ctx: ExtensionContext, file: MemoryBrowserFileItem): Promise<void> {
  const displayPath = toDisplayPath(ctx.cwd, file.path);

  try {
    const original = readTextFile(file.path);
    const updated = await ctx.ui.editor(`Inspect / edit ${displayPath}`, original);

    if (updated === undefined || updated === original) {
      return;
    }

    writeFileSync(file.path, updated, 'utf-8');
    ctx.ui.notify(`Saved ${displayPath}`, 'info');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Memory browser: ${message}`, 'error');
  }
}

async function browseMemory(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    return;
  }

  const context = resolveMemoryProfileContext(ctx.cwd);
  const menuStack: Array<() => MemoryBrowserMenu> = [() => buildMemoryBrowserRootMenu(context)];

  while (menuStack.length > 0) {
    const currentMenu = menuStack[menuStack.length - 1]!();
    const selection = await showMemoryMenu(ctx, currentMenu, menuStack.length > 1);

    if (selection === undefined) {
      return;
    }

    if (selection === 'noop') {
      continue;
    }

    if (selection === 'back') {
      menuStack.pop();
      continue;
    }

    if (selection.kind === 'menu') {
      menuStack.push(selection.buildMenu);
      continue;
    }

    await inspectOrEditMemoryFile(ctx, selection);
  }
}

export default function memoryExtension(pi: ExtensionAPI): void {
  pi.on('before_agent_start', async (event, ctx) => {
    const prompt = event.prompt?.trim() ?? '';
    if (prompt.length === 0) {
      return;
    }

    if (prompt.startsWith('/')) {
      return;
    }

    const context = resolveMemoryProfileContext(ctx.cwd);
    const memoryPolicy = buildMemoryPolicyBlock({
      cwd: context.cwd,
      repoRoot: context.repoRoot,
      requestedProfile: context.requestedProfile,
      activeProfile: context.activeProfile,
      activeProfileDir: context.activeProfileDir,
      activeAgentsFile: context.activeAgentsFile,
      activeSkillsDir: context.activeSkillsDir,
      activeTasksDir: context.activeTasksDir,
      activeMemoryDir: context.activeMemoryDir,
    });

    return {
      systemPrompt: `${event.systemPrompt}\n\n${memoryPolicy}`,
    };
  });

  pi.on('session_start', async (_event, ctx) => {
    applyMemoryStatus(ctx);
  });

  pi.on('session_switch', async (_event, ctx) => {
    applyMemoryStatus(ctx);
  });

  pi.on('session_fork', async (_event, ctx) => {
    applyMemoryStatus(ctx);
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    if (!ctx.hasUI) {
      return;
    }

    ctx.ui.setStatus(MEMORY_STATUS_KEY, undefined);
  });

  pi.registerCommand('memory', {
    description: 'Browse and edit AGENTS.md, skills, and memory docs from the TUI',
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }

      await browseMemory(ctx);
    },
  });
}
