import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@personal-agent/core': resolve(process.cwd(), 'packages/core/src/index.ts'),
      '@personal-agent/daemon': resolve(process.cwd(), 'packages/desktop/server/daemon/index.ts'),
      '@testing-library/react': resolve(process.cwd(), 'packages/desktop/node_modules/@testing-library/react'),
      '@personal-agent/extensions/host': resolve(process.cwd(), 'packages/desktop/ui/src/extensions/host.ts'),
      '@personal-agent/extensions/ui': resolve(process.cwd(), 'packages/desktop/ui/src/extensions/ui.ts'),
      '@personal-agent/extensions/workbench': resolve(process.cwd(), 'packages/desktop/ui/src/extensions/workbench.ts'),
      '@personal-agent/extensions/workbench-browser': resolve(process.cwd(), 'packages/desktop/ui/src/extensions/workbench-browser.ts'),
      '@personal-agent/extensions/workbench-diffs': resolve(process.cwd(), 'packages/desktop/ui/src/extensions/workbench-diffs.ts'),
      '@personal-agent/extensions/host-view-components': resolve(process.cwd(), 'packages/extensions/src/host-view-components.ts'),
      '@personal-agent/extensions/data': resolve(process.cwd(), 'packages/desktop/ui/src/extensions/data.ts'),
      '@personal-agent/extensions/settings': resolve(process.cwd(), 'packages/desktop/ui/src/extensions/settings.ts'),
      '@personal-agent/extensions/excalidraw': resolve(process.cwd(), 'packages/extensions/src/excalidraw.ts'),
      '@personal-agent/extensions/backend/agent': resolve(process.cwd(), 'packages/desktop/server/extensions/backendApi/agent.ts'),
      '@personal-agent/extensions/backend/artifacts': resolve(process.cwd(), 'packages/desktop/server/extensions/backendApi/artifacts.ts'),
      '@personal-agent/extensions/backend/automations': resolve(
        process.cwd(),
        'packages/desktop/server/extensions/backendApi/automations.ts',
      ),
      '@personal-agent/extensions/backend/browser': resolve(process.cwd(), 'packages/desktop/server/extensions/backendApi/browser.ts'),
      '@personal-agent/extensions/backend/checkpoints': resolve(
        process.cwd(),
        'packages/desktop/server/extensions/backendApi/checkpoints.ts',
      ),
      '@personal-agent/extensions/backend/compaction': resolve(
        process.cwd(),
        'packages/desktop/server/extensions/backendApi/compaction.ts',
      ),
      '@personal-agent/extensions/backend/conversations': resolve(
        process.cwd(),
        'packages/desktop/server/extensions/backendApi/conversations.ts',
      ),
      '@personal-agent/extensions/backend/events': resolve(process.cwd(), 'packages/desktop/server/extensions/backendApi/events.ts'),
      '@personal-agent/extensions/backend/images': resolve(process.cwd(), 'packages/desktop/server/extensions/backendApi/images.ts'),
      '@personal-agent/extensions/backend/knowledge': resolve(process.cwd(), 'packages/desktop/server/extensions/backendApi/knowledge.ts'),
      '@personal-agent/extensions/backend/knowledgeVault': resolve(
        process.cwd(),
        'packages/desktop/server/extensions/backendApi/knowledgeVault.ts',
      ),
      '@personal-agent/extensions/backend/mcp': resolve(process.cwd(), 'packages/desktop/server/extensions/backendApi/mcp.ts'),
      '@personal-agent/extensions/backend/runs': resolve(process.cwd(), 'packages/desktop/server/extensions/backendApi/runs.ts'),
      '@personal-agent/extensions/backend/runtime': resolve(process.cwd(), 'packages/desktop/server/extensions/backendApi/runtime.ts'),
      '@personal-agent/extensions/backend/telemetry': resolve(process.cwd(), 'packages/desktop/server/extensions/backendApi/telemetry.ts'),
      '@personal-agent/extensions/backend/slackMcpGateway': resolve(
        process.cwd(),
        'packages/desktop/server/extensions/backendApi/slackMcpGateway.ts',
      ),
      '@personal-agent/extensions/backend/webContent': resolve(
        process.cwd(),
        'packages/desktop/server/extensions/backendApi/webContent.ts',
      ),
      '@personal-agent/extensions/backend': resolve(process.cwd(), 'packages/desktop/server/extensions/backendApi/index.ts'),
      '@personal-agent/extensions': resolve(process.cwd(), 'packages/extensions/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['vitest.setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.taskfactory/**'],
    coverage: {
      include: [
        'packages/*/src/**/*.ts',
        'packages/desktop/ui/src/**/*.tsx',
        'packages/desktop/ui/src/**/*.ts',
        'packages/desktop/server/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.test.tsx',
        '**/*.spec.tsx',
        '**/node_modules/**',
        '**/dist/**',
        'packages/**/src/**/types.ts',
      ],
      reporter: ['text', 'text-summary', 'json-summary'],
    },
  },
});
