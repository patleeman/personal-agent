import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { truncateToWidth } from '@mariozechner/pi-tui';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;

interface RenderableComponent {
  render(width: number): string[];
  invalidate?(): void;
}

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

function toDisplayPath(cwd: string, targetPath: string): string {
  const resolvedTarget = resolve(targetPath);
  const relativePath = relative(cwd, resolvedTarget);

  if (relativePath.length > 0 && relativePath !== '.' && !relativePath.startsWith(`..${sep}`) && relativePath !== '..') {
    return relativePath.replace(/\\/g, '/');
  }

  const home = process.env.HOME?.trim();
  if (home) {
    const resolvedHome = resolve(home);

    if (resolvedTarget === resolvedHome) {
      return '~';
    }

    if (resolvedTarget.startsWith(`${resolvedHome}${sep}`)) {
      const fromHome = relative(resolvedHome, resolvedTarget).replace(/\\/g, '/');
      return fromHome.length > 0 ? `~/${fromHome}` : '~';
    }
  }

  return resolvedTarget.replace(/\\/g, '/');
}

interface PaSummary {
  activeProfile: string;
  requestedProfile: string;
  sourceAgents: string;
  runtimeAgents: string;
}

function resolvePaSummary(cwd: string): PaSummary {
  const repoRoot = resolveRepoRoot();
  const requestedProfile = resolveRequestedProfile();
  const requestedProfileDir = join(repoRoot, 'profiles', requestedProfile, 'agent');
  const sharedProfileDir = join(repoRoot, 'profiles', 'shared', 'agent');

  const activeProfile = existsSync(requestedProfileDir) ? requestedProfile : 'shared';
  const activeProfileDir = activeProfile === requestedProfile
    ? requestedProfileDir
    : sharedProfileDir;

  const activeAgentsFile = activeProfile === 'shared'
    ? undefined
    : join(activeProfileDir, 'AGENTS.md');

  const runtimeAgentDir = process.env.PI_CODING_AGENT_DIR?.trim();
  const runtimeAgentsFile = runtimeAgentDir
    ? join(resolve(runtimeAgentDir), 'AGENTS.md')
    : undefined;

  const sourceAgents = activeAgentsFile
    ? toDisplayPath(cwd, activeAgentsFile)
    : 'none (shared profile)';

  const runtimeAgents = runtimeAgentsFile
    ? toDisplayPath(cwd, runtimeAgentsFile)
    : 'unknown (PI_CODING_AGENT_DIR is not set)';

  return {
    activeProfile,
    requestedProfile,
    sourceAgents,
    runtimeAgents,
  };
}

function isRenderableComponent(value: unknown): value is RenderableComponent {
  return !!value && typeof (value as RenderableComponent).render === 'function';
}

function findBuiltInHeaderComponent(tui: unknown): RenderableComponent | undefined {
  const root = tui as { children?: unknown[] } | undefined;
  const headerContainer = Array.isArray(root?.children)
    ? root.children[0] as { children?: unknown[] } | undefined
    : undefined;

  const headerChildren = Array.isArray(headerContainer?.children)
    ? headerContainer.children
    : [];

  for (const child of headerChildren) {
    if (!isRenderableComponent(child)) {
      continue;
    }

    const constructorName = (child as { constructor?: { name?: string } }).constructor?.name;
    if (constructorName === 'Text') {
      return child;
    }
  }

  return headerChildren.find((child) => isRenderableComponent(child));
}

function renderHeaderLines(component: RenderableComponent | undefined, width: number): string[] {
  if (!component) {
    return [];
  }

  try {
    const rendered = component.render(width);
    return Array.isArray(rendered) ? rendered : [];
  } catch {
    return [];
  }
}

function applyPaHeader(ctx: ExtensionContext): void {
  if (!ctx.hasUI) {
    return;
  }

  const summary = resolvePaSummary(ctx.cwd);

  ctx.ui.setHeader((tui, theme) => {
    const builtInHeader = findBuiltInHeaderComponent(tui);

    return {
      render(width: number): string[] {
        const existingHeaderLines = renderHeaderLines(builtInHeader, width);
        const paLines = [
          truncateToWidth(theme.fg('accent', `[${summary.activeProfile}]`), width),
        ];

        if (summary.requestedProfile !== summary.activeProfile) {
          paLines.push(
            truncateToWidth(
              `${theme.fg('dim', '  requested profile: ')}${summary.requestedProfile}${theme.fg('dim', ` (using ${summary.activeProfile})`)}`,
              width,
            ),
          );
        }

        paLines.push(
          truncateToWidth(`${theme.fg('dim', '  source AGENTS.md: ')}${summary.sourceAgents}`, width),
          truncateToWidth(`${theme.fg('dim', '  runtime AGENTS.md: ')}${summary.runtimeAgents}`, width),
        );

        if (existingHeaderLines.length === 0) {
          return paLines;
        }

        return [...existingHeaderLines, '', ...paLines];
      },
      invalidate(): void {
        builtInHeader?.invalidate?.();
      },
    };
  });
}

export default function paHeaderExtension(pi: ExtensionAPI): void {
  pi.on('session_start', async (_event, ctx) => {
    applyPaHeader(ctx);
  });
}
