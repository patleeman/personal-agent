import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@personal-agent/core': resolve(process.cwd(), 'packages/core/src/index.ts'),
      '@personal-agent/daemon': resolve(process.cwd(), 'packages/desktop/server/daemon/index.ts'),
      '@personal-agent/extensions/host': resolve(process.cwd(), 'packages/desktop/ui/src/extensions/host.ts'),
      '@personal-agent/extensions/ui': resolve(process.cwd(), 'packages/desktop/ui/src/extensions/ui.ts'),
      '@personal-agent/extensions/workbench': resolve(process.cwd(), 'packages/desktop/ui/src/extensions/workbench.ts'),
      '@personal-agent/extensions/data': resolve(process.cwd(), 'packages/desktop/ui/src/extensions/data.ts'),
      '@personal-agent/extensions/settings': resolve(process.cwd(), 'packages/desktop/ui/src/extensions/settings.ts'),
      '@personal-agent/extensions/excalidraw': resolve(process.cwd(), 'packages/extensions/src/excalidraw.ts'),
      '@personal-agent/extensions/backend/artifacts': resolve(process.cwd(), 'packages/desktop/server/extensions/backendApi/artifacts.ts'),
      '@personal-agent/extensions/backend/checkpoints': resolve(
        process.cwd(),
        'packages/desktop/server/extensions/backendApi/checkpoints.ts',
      ),
      '@personal-agent/extensions/backend': resolve(process.cwd(), 'packages/desktop/server/extensions/backendApi/index.ts'),
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
