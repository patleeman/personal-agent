import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateExtensionPackage } from './extensionDoctor.js';

function createExtensionPackage() {
  const root = mkdtempSync(join(tmpdir(), 'pa-extension-doctor-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(
    join(root, 'extension.json'),
    JSON.stringify(
      {
        schemaVersion: 2,
        id: 'doctor-test',
        name: 'Doctor Test',
        version: '0.1.0',
        frontend: { entry: 'dist/frontend.js' },
        backend: { entry: 'dist/backend.mjs', actions: [{ id: 'ping', handler: 'ping', title: 'Ping' }] },
        contributes: {
          views: [{ id: 'page', title: 'Doctor Test', location: 'main', route: '/ext/doctor-test', component: 'DoctorPage' }],
          tools: [
            {
              id: 'ping',
              name: 'doctor_ping',
              description: 'Ping the doctor test extension.',
              action: 'ping',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
        permissions: [],
      },
      null,
      2,
    ),
  );
  return root;
}

describe('extension doctor', () => {
  it('accepts a healthy built extension package', async () => {
    const root = createExtensionPackage();
    writeFileSync(join(root, 'src', 'frontend.tsx'), `export function DoctorPage() { return null; }\n`);
    writeFileSync(join(root, 'src', 'backend.ts'), `export async function ping() { return { ok: true }; }\n`);
    writeFileSync(join(root, 'dist', 'frontend.js'), `export function DoctorPage() { return null; }\n`);
    writeFileSync(join(root, 'dist', 'backend.mjs'), `export async function ping() { return { ok: true }; }\n`);

    const report = await validateExtensionPackage({ packageRoot: root });

    expect(report.ok).toBe(true);
    expect(report.summary.errors).toBe(0);
  });

  it('reports missing exports and non-portable imports with fixable findings', async () => {
    const root = createExtensionPackage();
    writeFileSync(join(root, 'src', 'frontend.tsx'), `export function WrongPage() { return null; }\n`);
    writeFileSync(join(root, 'src', 'backend.ts'), `import 'node:child_process';\nexport async function wrong() { return {}; }\n`);
    writeFileSync(join(root, 'dist', 'frontend.js'), `import '/tmp/release-only.js';\nexport function WrongPage() { return null; }\n`);
    writeFileSync(join(root, 'dist', 'backend.mjs'), `import '/tmp/release-only.js';\nexport async function wrong() { return {}; }\n`);

    const report = await validateExtensionPackage({ packageRoot: root });
    const codes = report.findings.map((finding) => finding.code);

    expect(report.ok).toBe(false);
    expect(codes).toContain('missing-frontend-export');
    expect(codes).toContain('missing-backend-export');
    expect(codes).toContain('forbidden-process-import');
    expect(codes).toContain('non-portable-import');
    expect(codes).toContain('backend-import-failed');
  });
});
