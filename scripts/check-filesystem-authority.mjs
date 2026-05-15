#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const scopedFiles = [
  'packages/desktop/server/workspace/workspaceExplorer.ts',
  'packages/desktop/server/extensions/extensionWorkspace.ts',
  'packages/desktop/server/extensions/backendApi/knowledgeVault.ts',
  'packages/desktop/server/routes/vaultEditor.ts',
  'packages/desktop/server/routes/vaultShareImport.ts',
];

const banned = [
  /function\s+assertSafeWorkspacePath\b/,
  /function\s+assertInside\b/,
  /function\s+isInsideRoot\([^)]*target[^)]*\)\s*{\s*const\s+rel\s*=\s*relative\(/s,
  /\.resolvePath\s*\(/,
  /\.runSync\s*\(/,
  /requestRootSync\s*\(/,
  /from\s+['"]node:fs(?:\/promises)?['"]/,
];

let failed = false;
for (const file of scopedFiles) {
  const content = readFileSync(file, 'utf-8');
  for (const pattern of banned) {
    if (pattern.test(content)) {
      console.error(`${file}: scoped filesystem path handling must go through Filesystem Authority (${pattern})`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
