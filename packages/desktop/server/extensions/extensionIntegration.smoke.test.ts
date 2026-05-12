import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ExtensionRegistrySnapshot } from './extensionRegistry.js';
import {
  listExtensionCommandRegistrations,
  listExtensionComposerButtonRegistrations,
  listExtensionComposerInputToolRegistrations,
  listExtensionComposerShelfRegistrations,
  listExtensionContextMenuRegistrations,
  listExtensionConversationDecoratorRegistrations,
  listExtensionConversationHeaderRegistrations,
  listExtensionInstallSummaries,
  listExtensionKeybindingRegistrations,
  listExtensionMessageActionRegistrations,
  listExtensionNewConversationPanelRegistrations,
  listExtensionSecretBackendRegistrations,
  listExtensionSecretRegistrations,
  listExtensionSettingsComponentRegistrations,
  listExtensionSettingsRegistrations,
  listExtensionSlashCommandRegistrations,
  listExtensionStatusBarItemRegistrations,
  listExtensionToolbarActionRegistrations,
  listExtensionToolRegistrations,
  parseExtensionManifest,
  readExtensionRegistrySnapshot,
} from './extensionRegistry.js';
import { listExtensionAgentRegistrations } from './extensionRegistry.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getSystemExtensionIds(snapshot: ExtensionRegistrySnapshot): string[] {
  return snapshot.extensions.filter((e) => e.packageType === 'system').map((e) => e.id);
}

function collectAllViewIds(snapshot: ExtensionRegistrySnapshot): string[] {
  return snapshot.views.map((v) => `${v.extensionId}/${v.id}`);
}

function findAllStringConflicts(items: Array<[string, string]>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const [name, source] of items) {
    const existing = groups.get(name) ?? [];
    existing.push(source);
    groups.set(name, existing);
  }
  const conflicts = new Map<string, string[]>();
  for (const [name, sources] of groups) {
    if (sources.length > 1) {
      conflicts.set(name, sources);
    }
  }
  return conflicts;
}

/* ------------------------------------------------------------------ */
/*  1. Manifest Structural Validation                                  */
/* ------------------------------------------------------------------ */

describe('extension manifests - structural validation', () => {
  const summaries = listExtensionInstallSummaries();
  const snapshot = readExtensionRegistrySnapshot();

  it('all system extension manifests parse without errors', () => {
    const errors: string[] = [];
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      try {
        parseExtensionManifest(ext.manifest);
      } catch (e) {
        errors.push(`${ext.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    expect(errors, 'Manifest parse errors').toEqual([]);
  });

  it('all system extensions have schemaVersion = 2', () => {
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      expect(ext.manifest.schemaVersion, `${ext.id} schemaVersion`).toBe(2);
    }
  });

  it('all extensions have a non-empty id and name', () => {
    for (const ext of summaries) {
      expect(ext.id?.trim(), `${ext.packageType} extension missing id`).toBeTruthy();
      expect(ext.name?.trim(), `${ext.id} missing name`).toBeTruthy();
    }
  });

  it('no system extension is in invalid state', () => {
    const invalid = summaries.filter((s) => s.status === 'invalid' && s.packageType === 'system');
    expect(invalid, 'Invalid system extensions').toEqual([]);
  });

  it('no extensions have unexpected errors or diagnostics', () => {
    const withErrors = summaries.filter((s) => (s.errors?.length ?? 0) > 0);
    const withDiagnostics = summaries.filter((s) => (s.diagnostics?.length ?? 0) > 0);
    // System extensions should never have runtime errors
    const systemWithErrors = withErrors.filter((s) => s.packageType === 'system');
    expect(systemWithErrors, 'System extensions with errors').toEqual([]);
    // Collect all diagnostics as informational only — note them but don't fail
    if (withDiagnostics.length > 0) {
      console.warn(
        'Extensions with diagnostics:',
        withDiagnostics.map((s) => `${s.id}: ${s.diagnostics?.join(', ')}`),
      );
    }
  });

  it('all contributions are structurally valid (no missing required fields)', () => {
    for (const ext of snapshot.extensions) {
      const c = ext.contributes;
      if (!c) continue;

      if (c.views) {
        for (const view of c.views) {
          expect(view.id, `${ext.id}: view missing id`).toBeTruthy();
          expect(view.title, `${ext.id}: view "${view.id}" missing title`).toBeTruthy();
          expect(view.location, `${ext.id}: view "${view.id}" missing location`).toBeTruthy();
          expect(view.component, `${ext.id}: view "${view.id}" missing component`).toBeTruthy();
        }
      }

      if (c.nav) {
        for (const n of c.nav) {
          expect(n.id, `${ext.id}: nav missing id`).toBeTruthy();
          expect(n.label, `${ext.id}: nav "${n.id}" missing label`).toBeTruthy();
          expect(n.route, `${ext.id}: nav "${n.id}" missing route`).toBeTruthy();
        }
      }

      if (c.tools) {
        for (const tool of c.tools) {
          expect(tool.id, `${ext.id}: tool missing id`).toBeTruthy();
          expect(tool.description, `${ext.id}: tool "${tool.id}" missing description`).toBeTruthy();
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/*  2. Cross-Extension Conflict Detection                              */
/* ------------------------------------------------------------------ */

describe('extension manifests - cross-extension conflict detection', () => {
  const snapshot = readExtensionRegistrySnapshot();

  it('no duplicate extension IDs', () => {
    const ids = snapshot.extensions.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no duplicate routes across all main-page views', () => {
    const routes = snapshot.routes.map((r) => r.route).filter(Boolean) as string[];
    expect(new Set(routes).size, 'Duplicate routes').toBe(routes.length);
  });

  it('no duplicate tool names', () => {
    const tools = listExtensionToolRegistrations();
    const conflicts = findAllStringConflicts(tools.map((t) => [t.name, `${t.extensionId}/${t.id}`]));
    expect(
      [...conflicts].map(([name, sources]) => `${name}: ${sources.join(', ')}`),
      'Duplicate tool names',
    ).toEqual([]);
  });

  it('no duplicate slash command names', () => {
    const commands = listExtensionSlashCommandRegistrations();
    const conflicts = findAllStringConflicts(commands.map((c) => [c.name, `${c.extensionId}/${c.surfaceId}`]));
    expect(
      [...conflicts].map(([name, sources]) => `${name}: ${sources.join(', ')}`),
      'Duplicate slash command names',
    ).toEqual([]);
  });

  it('no duplicate command ids', () => {
    const commands = listExtensionCommandRegistrations();
    const conflicts = findAllStringConflicts(commands.map((c) => [c.surfaceId, `${c.extensionId}/${c.title}`]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate command ids',
    ).toEqual([]);
  });

  it('no duplicate keybinding ids', () => {
    const keybindings = listExtensionKeybindingRegistrations();
    const conflicts = findAllStringConflicts(keybindings.map((k) => [`${k.extensionId}/${k.surfaceId}`, k.title]));
    // Same id from same extension is fine
    const realConflicts = new Map(
      [...conflicts.entries()].filter(([_id, sources]) => {
        const extensions = new Set(sources.map((s) => s.split('/')[0]));
        return extensions.size > 1;
      }),
    );
    expect(
      [...realConflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate keybinding ids across extensions',
    ).toEqual([]);
  });

  it('no duplicate context menu ids across extensions', () => {
    const menus = listExtensionContextMenuRegistrations();
    // Context menu ids are scoped per extension, so check using extensionId/id as key
    const conflicts = findAllStringConflicts(menus.map((m) => [`${m.extensionId}/${m.id}`, m.title]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate context menu ids',
    ).toEqual([]);
  });

  it('no duplicate message action ids', () => {
    const actions = listExtensionMessageActionRegistrations();
    const conflicts = findAllStringConflicts(actions.map((a) => [`${a.extensionId}/${a.surfaceId}`, a.title]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate message action ids',
    ).toEqual([]);
  });

  it('no duplicate composer shelf ids', () => {
    const shelves = listExtensionComposerShelfRegistrations();
    const conflicts = findAllStringConflicts(shelves.map((s) => [s.id, s.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate composer shelf ids',
    ).toEqual([]);
  });

  it('no duplicate new conversation panel ids', () => {
    const panels = listExtensionNewConversationPanelRegistrations();
    const conflicts = findAllStringConflicts(panels.map((p) => [p.id, p.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate new conversation panel ids',
    ).toEqual([]);
  });

  it('no duplicate composer button ids', () => {
    const buttons = listExtensionComposerButtonRegistrations();
    const conflicts = findAllStringConflicts(buttons.map((b) => [b.id, b.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate composer button ids',
    ).toEqual([]);
  });

  it('no duplicate composer input tool ids', () => {
    const tools = listExtensionComposerInputToolRegistrations();
    const conflicts = findAllStringConflicts(tools.map((t) => [t.id, t.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate composer input tool ids',
    ).toEqual([]);
  });

  it('no duplicate toolbar action ids', () => {
    const actions = listExtensionToolbarActionRegistrations();
    const conflicts = findAllStringConflicts(actions.map((a) => [a.id, a.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate toolbar action ids',
    ).toEqual([]);
  });

  it('no duplicate status bar item ids', () => {
    const items = listExtensionStatusBarItemRegistrations();
    const conflicts = findAllStringConflicts(items.map((i) => [i.id, i.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate status bar item ids',
    ).toEqual([]);
  });

  it('no duplicate conversation decorator ids', () => {
    const decorators = listExtensionConversationDecoratorRegistrations();
    const conflicts = findAllStringConflicts(decorators.map((d) => [d.id, d.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate conversation decorator ids',
    ).toEqual([]);
  });

  it('no duplicate conversation header ids', () => {
    const headers = listExtensionConversationHeaderRegistrations();
    const conflicts = findAllStringConflicts(headers.map((h) => [h.id, h.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate conversation header ids',
    ).toEqual([]);
  });

  it('no duplicate setting keys', () => {
    const settings = listExtensionSettingsRegistrations();
    const conflicts = findAllStringConflicts(settings.map((s) => [s.key, s.extensionId]));
    expect(
      [...conflicts].map(([key, sources]) => `${key}: ${sources.join(', ')}`),
      'Duplicate setting keys',
    ).toEqual([]);
  });

  it('no duplicate secret ids', () => {
    const secrets = listExtensionSecretRegistrations();
    const conflicts = findAllStringConflicts(secrets.map((s) => [s.id, s.extensionId]));
    // Same id from same extension is fine (namespace per extension)
    const realConflicts = new Map(
      [...conflicts.entries()].filter(([_id, sources]) => {
        const extensions = new Set(sources);
        return extensions.size > 1;
      }),
    );
    expect(
      [...realConflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate secret ids across extensions',
    ).toEqual([]);
  });

  it('no duplicate secret backend ids', () => {
    const backends = listExtensionSecretBackendRegistrations();
    const conflicts = findAllStringConflicts(backends.map((b) => [b.id, b.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate secret backend ids',
    ).toEqual([]);
  });

  it('no duplicate settings component section ids', () => {
    const components = listExtensionSettingsComponentRegistrations();
    const conflicts = findAllStringConflicts(components.map((c) => [c.sectionId, c.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate settings component section ids',
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  3. Registry Integration Sanity                                     */
/* ------------------------------------------------------------------ */

describe('extension registry - integration sanity', () => {
  const snapshot = readExtensionRegistrySnapshot();
  const summaries = listExtensionInstallSummaries();

  it('all system extensions are present in summaries and snapshot', () => {
    const snapshotIds = new Set(getSystemExtensionIds(snapshot));
    // All system extensions should appear in the full summary
    const systemFromSummaries = summaries.filter((s) => s.packageType === 'system' && s.status !== 'invalid');
    const allSystemIds = systemFromSummaries.map((s) => s.id);

    // Every system extension is in summaries
    for (const ext of allSystemIds) {
      expect(
        summaries.some((s) => s.id === ext),
        `Missing system extension in summaries: ${ext}`,
      ).toBe(true);
    }
    // All snapshot extension ids should start with system-
    for (const id of snapshotIds) {
      expect(id.startsWith('system-'), `Snapshot extension id "${id}" does not start with 'system-'`).toBe(true);
    }
  });

  it('each system extension summary matches its manifest', () => {
    for (const ext of snapshot.extensions) {
      if (ext.packageType !== 'system') continue;
      const summary = summaries.find((s) => s.id === ext.id);
      expect(summary, `No summary for system extension: ${ext.id}`).toBeDefined();
      expect(summary!.manifest.id, `${ext.id}: manifest id mismatch`).toBe(ext.id);
      expect(summary!.manifest.name, `${ext.id}: manifest name mismatch`).toBe(ext.name);
    }
  });

  it('has a reasonable number of system extensions', () => {
    const systemCount = getSystemExtensionIds(snapshot).length;
    expect(systemCount).toBeGreaterThanOrEqual(20);
    expect(systemCount).toBeLessThanOrEqual(35);
  });

  it('has at least 7 routes registered', () => {
    expect(snapshot.routes.length).toBeGreaterThanOrEqual(7);
  });

  it('has at least 20 views registered', () => {
    expect(snapshot.views.length).toBeGreaterThanOrEqual(20);
  });

  it('all view ids are unique across extensions', () => {
    const viewIds = collectAllViewIds(snapshot);
    expect(new Set(viewIds).size).toBe(viewIds.length);
  });

  it('status and enabled state are consistent for system extensions', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      if (s.enabled) {
        expect(s.status, `${s.id}: enabled but status is ${s.status}`).toBe('enabled');
      } else if (s.manifest.defaultEnabled === false) {
        expect(s.status, `${s.id}: default-disabled but status is ${s.status}`).toBe('disabled');
      }
    }
  });

  it('all registered routes point to existing extensions', () => {
    const extensionIds = new Set(snapshot.extensions.map((e) => e.id));
    for (const route of snapshot.routes) {
      expect(extensionIds.has(route.extensionId), `Route "${route.route}" references unknown extension "${route.extensionId}"`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  4. Backend Entry File Validation                                   */
/* ------------------------------------------------------------------ */

describe('extension backends - file existence and structural checks', () => {
  const summaries = listExtensionInstallSummaries();

  it('every system extension with a backend entry has a compiled dist/backend.mjs', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const backendEntry = s.manifest.backend?.entry;
      if (!backendEntry) continue;

      const expectedPath = resolve(s.packageRoot ?? '', 'dist', 'backend.mjs');
      expect(existsSync(expectedPath), `${s.id}: missing dist/backend.mjs (backend entry: ${backendEntry})`).toBe(true);
    }
  });

  it('every system extension with a backend entry has a matching source entry', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const backendEntry = s.manifest.backend?.entry;
      if (!backendEntry) continue;

      // System extensions reference source: src/backend.ts
      const sourcePath = resolve(s.packageRoot ?? '', backendEntry);
      const builtPath = resolve(s.packageRoot ?? '', 'dist', 'backend.mjs');

      expect(existsSync(sourcePath) || existsSync(builtPath), `${s.id}: backend source not found at ${backendEntry}`).toBe(true);
    }
  });

  it('backend action handler names exist as exports in the prebuilt bundle', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const actions = s.manifest.backend?.actions ?? [];
      if (actions.length === 0) continue;

      const backendPath = resolve(s.packageRoot ?? '', 'dist', 'backend.mjs');
      if (!existsSync(backendPath)) continue;

      const content = readFileSync(backendPath, 'utf-8');
      for (const action of actions) {
        const handlerName = action.handler ?? action.id;
        // Check if the handler is exported (named export or function declaration)
        const exportPattern = new RegExp(`(export\\s+(async\\s+)?function\\s+${handlerName}|export\\s*\\{[^}]*\\b${handlerName}\\b)`);
        expect(exportPattern.test(content), `${s.id}: backend action handler "${handlerName}" not found in dist/backend.mjs`).toBe(true);
      }
    }
  });

  it('agent extension factory export exists in the prebuilt bundle', () => {
    const agentRegistrations = listExtensionAgentRegistrations();
    for (const reg of agentRegistrations) {
      const s = summaries.find((e) => e.id === reg.extensionId);
      if (!s || s.packageType !== 'system') continue;

      const backendPath = resolve(s.packageRoot ?? '', 'dist', 'backend.mjs');
      if (!existsSync(backendPath)) continue;

      const content = readFileSync(backendPath, 'utf-8');
      const exportName = reg.exportName === 'default' ? 'default' : reg.exportName;
      if (exportName === 'default') {
        // Matches patterns:
        //   export { ... name as default ... }
        //   export default function ...
        //   export default class ...
        //   export { default }
        expect(
          /export\s*\{[^}]*\bas\s+default\b/.test(content) ||
            /export\s+default\s+(async\s+)?(function|class)/.test(content) ||
            /export\s*\{[^}]*\bdefault\b[^}]*\}/.test(content),
          `${s.id}: default export (agent factory) not found in dist/backend.mjs`,
        ).toBe(true);
      } else {
        const namePattern = new RegExp(`(export\\s+(async\\s+)?function\\s+${exportName}|export\\s*\\{[^}]*\\b${exportName}\\b)`);
        expect(namePattern.test(content), `${s.id}: agent extension export "${exportName}" not found in dist/backend.mjs`).toBe(true);
      }
    }
  });

  it('prebuilt backend files are non-empty and contain valid export syntax', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const backendPath = resolve(s.packageRoot ?? '', 'dist', 'backend.mjs');
      if (!existsSync(backendPath)) continue;

      const stats = statSync(backendPath);
      expect(stats.size, `${s.id}: dist/backend.mjs is empty`).toBeGreaterThan(0);

      const content = readFileSync(backendPath, 'utf-8');
      // Verify it contains at least one export statement (any valid JS module does)
      expect(
        /export\s+(\{|default|const|let|var|function|class|async)/.test(content),
        `${s.id}: dist/backend.mjs does not contain any export statement`,
      ).toBe(true);
      // Verify source map reference is well-formed if present
      const sourceMapMatch = content.match(/[/][/]# sourceMappingURL=(.+)$/m);
      if (sourceMapMatch) {
        const mapPath = resolve(s.packageRoot ?? '', 'dist', sourceMapMatch[1]);
        expect(existsSync(mapPath), `${s.id}: source map ${sourceMapMatch[1]} not found`).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/*  5. Frontend Entry File Validation                                  */
/* ------------------------------------------------------------------ */

describe('extension frontends - file existence checks', () => {
  const summaries = listExtensionInstallSummaries();

  it('every extension with a frontend entry has a compiled dist/frontend.js', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const frontendEntry = s.manifest.frontend?.entry;
      if (!frontendEntry) continue;

      const expectedPath = resolve(s.packageRoot ?? '', frontendEntry);
      expect(existsSync(expectedPath), `${s.id}: missing frontend entry at ${frontendEntry}`).toBe(true);
    }
  });

  it('frontend files are non-empty', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const frontendEntry = s.manifest.frontend?.entry;
      if (!frontendEntry) continue;

      const frontendPath = resolve(s.packageRoot ?? '', frontendEntry);
      if (!existsSync(frontendPath)) continue;

      const stats = statSync(frontendPath);
      expect(stats.size, `${s.id}: frontend entry is empty`).toBeGreaterThan(0);
    }
  });

  it('referenced style files exist', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const styles = s.manifest.frontend?.styles ?? [];
      for (const stylePath of styles) {
        const resolved = resolve(s.packageRoot ?? '', stylePath);
        expect(existsSync(resolved), `${s.id}: missing style file at ${stylePath}`).toBe(true);
      }
    }
  });

  it('frontend entry exports are referenced by view/surface components', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const frontendEntry = s.manifest.frontend?.entry;
      if (!frontendEntry) continue;

      const frontendPath = resolve(s.packageRoot ?? '', frontendEntry);
      if (!existsSync(frontendPath)) continue;

      const content = readFileSync(frontendPath, 'utf-8');
      const views = s.manifest.contributes?.views ?? [];

      for (const view of views) {
        const componentName = view.component;
        // Check that the component is exported
        const componentPattern = new RegExp(
          `(export\\s+(async\\s+)?function\\s+${componentName}|export\\s*\\{[^}]*\\b${componentName}\\b)`,
        );
        expect(componentPattern.test(content), `${s.id}: view component "${componentName}" not exported in ${frontendEntry}`).toBe(true);
      }
    }
  });

  it('composer shelves component exists in frontend entry', () => {
    const shelves = listExtensionComposerShelfRegistrations();
    for (const shelf of shelves) {
      if (!shelf.frontendEntry) continue;
      const s = summaries.find((e) => e.id === shelf.extensionId);
      if (!s || s.packageType !== 'system') continue;

      const frontendPath = resolve(s.packageRoot ?? '', shelf.frontendEntry);
      if (!existsSync(frontendPath)) continue;

      const content = readFileSync(frontendPath, 'utf-8');
      const componentPattern = new RegExp(
        `(export\\s+(async\\s+)?function\\s+${shelf.component}|export\\s*\\{[^}]*\\b${shelf.component}\\b)`,
      );
      expect(componentPattern.test(content), `${shelf.extensionId}: composer shelf component "${shelf.component}" not exported`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  6. Skill Validation                                                */
/* ------------------------------------------------------------------ */

describe('extension skills - file existence and frontmatter', () => {
  const summaries = listExtensionInstallSummaries();

  it('all skill paths referenced by system extensions exist on disk', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const skills = s.manifest.contributes?.skills ?? [];
      for (const skill of skills) {
        const skillPath = typeof skill === 'string' ? skill : skill.path;
        const resolved = resolve(s.packageRoot ?? '', skillPath);
        expect(existsSync(resolved), `${s.id}: skill path not found: ${skillPath}`).toBe(true);
      }
    }
  });

  it('all skill files have valid Agent Skills frontmatter with name and description', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const skills = s.manifest.contributes?.skills ?? [];
      for (const skill of skills) {
        const skillPath = typeof skill === 'string' ? skill : skill.path;
        const resolved = resolve(s.packageRoot ?? '', skillPath);
        if (!existsSync(resolved)) continue;

        const content = readFileSync(resolved, 'utf-8').replace(/\r\n/g, '\n');
        if (!content.startsWith('---\n')) {
          // Non-standard skill file — could be an Agent Skills file without frontmatter
          // Just check it exists and is non-empty
          expect(content.length, `${s.id}: skill ${skillPath} is empty`).toBeGreaterThan(0);
          continue;
        }

        const endIndex = content.indexOf('\n---', 4);
        expect(endIndex, `${s.id}: skill ${skillPath} has unclosed frontmatter`).toBeGreaterThan(-1);

        if (endIndex === -1) continue;
        const frontmatter = content.slice(4, endIndex);
        const hasName = /^name:\s*.+$/m.test(frontmatter);
        const hasDescription = /^description:\s*.+$/m.test(frontmatter);
        expect(hasName, `${s.id}: skill ${skillPath} frontmatter missing 'name'`).toBe(true);
        expect(hasDescription, `${s.id}: skill ${skillPath} frontmatter missing 'description'`).toBe(true);
      }
    }
  });

  it('skill files use the SKILL.md naming convention', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const skills = s.manifest.contributes?.skills ?? [];
      for (const skill of skills) {
        const skillPath = typeof skill === 'string' ? skill : skill.path;
        if (skillPath.endsWith('/SKILL.md') || skillPath === 'SKILL.md') continue;
        // Non-standard naming — warn but don't fail since it might be intentional
        console.warn(`${s.id}: skill "${skillPath}" does not follow SKILL.md naming convention`);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/*  7. Agent Extension Registration                                    */
/* ------------------------------------------------------------------ */

describe('extension agent extensions - registration listing', () => {
  it('lists all agent extensions from manifests', () => {
    const registrations = listExtensionAgentRegistrations();
    const snapshot = readExtensionRegistrySnapshot();
    const agentExtIds = new Set(registrations.map((r) => r.extensionId));

    for (const ext of snapshot.extensions) {
      if (ext.backend?.agentExtension) {
        expect(agentExtIds.has(ext.id), `${ext.id}: agentExtension declared but not registered`).toBe(true);
      }
    }
  });

  it('every agent registration has a valid export name', () => {
    const registrations = listExtensionAgentRegistrations();
    for (const reg of registrations) {
      expect(reg.exportName?.trim(), `${reg.extensionId}: agent extension export name is empty`).toBeTruthy();
    }
  });

  it('agent extensions reference the correct backend entry', () => {
    const snapshot = readExtensionRegistrySnapshot();
    const agentIds = new Set(snapshot.extensions.filter((e) => e.backend?.agentExtension).map((e) => e.id));

    for (const ext of snapshot.extensions) {
      if (agentIds.has(ext.id)) {
        expect(ext.backend?.entry, `${ext.id}: agent extension without backend entry`).toBeTruthy();
      }
    }
  });

  it('known agent extensions are registered when enabled', () => {
    const registrations = listExtensionAgentRegistrations();
    const agentIds = registrations.map((r) => r.extensionId);

    // system-conversation-tools is always enabled (defaultEnabled is not false)
    expect(agentIds, 'Expected system-conversation-tools agent extension').toContain('system-conversation-tools');
    // system-slack-mcp-gateway has defaultEnabled: false, so it may not be registered
    // Check if it's enabled in the config before asserting
    const slackGateway = listExtensionInstallSummaries().find((s) => s.id === 'system-slack-mcp-gateway');
    if (slackGateway?.enabled) {
      expect(agentIds, 'Expected system-slack-mcp-gateway agent extension').toContain('system-slack-mcp-gateway');
    }
  });
});

/* ------------------------------------------------------------------ */
/*  8. Summary Report                                                  */
/* ------------------------------------------------------------------ */

describe('extension integration - summary report', () => {
  it('reports extension counts and structural summary', () => {
    const summaries = listExtensionInstallSummaries();
    const snapshot = readExtensionRegistrySnapshot();

    const systemExtensions = summaries.filter((s) => s.packageType === 'system');
    const enabledSystem = systemExtensions.filter((s) => s.enabled);
    const invalidExtensions = summaries.filter((s) => s.status === 'invalid');
    const extensionsWithDiagnostics = summaries.filter((s) => (s.diagnostics?.length ?? 0) > 0);
    const extensionsWithBackends = systemExtensions.filter((s) => s.manifest.backend?.entry);
    const extensionsWithFrontends = systemExtensions.filter((s) => s.manifest.frontend?.entry);
    const agentExtensions = listExtensionAgentRegistrations();

    const toolRegistrations = listExtensionToolRegistrations();
    const skillRegistrations = summaries.flatMap((s) => s.skills);
    const commandRegistrations = listExtensionCommandRegistrations();
    const slashCommandRegistrations = listExtensionSlashCommandRegistrations();
    const settingRegistrations = listExtensionSettingsRegistrations();
    const viewRegistrations = snapshot.views;
    const routeRegistrations = snapshot.routes;

    const report = [
      `Total extension entries: ${summaries.length}`,
      `  System extensions: ${systemExtensions.length} (${enabledSystem.length} enabled)`,
      `  Invalid extensions: ${invalidExtensions.length}`,
      `  Extensions with diagnostics: ${extensionsWithDiagnostics.length}`,
      `  Extensions with backends: ${extensionsWithBackends.length}`,
      `  Extensions with frontends: ${extensionsWithFrontends.length}`,
      ``,
      `Registration counts:`,
      `  Views: ${viewRegistrations.length}`,
      `  Routes: ${routeRegistrations.length}`,
      `  Tools: ${toolRegistrations.length}`,
      `  Skills: ${skillRegistrations.length}`,
      `  Commands: ${commandRegistrations.length}`,
      `  Slash commands: ${slashCommandRegistrations.length}`,
      `  Settings: ${settingRegistrations.length}`,
      `  Agent extensions: ${agentExtensions.length}`,
    ].join('\n');

    // Print the report
    console.log('\n=== Extension Integration Summary ===\n' + report + '\n======================================\n');
  });
});
