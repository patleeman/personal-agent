import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@personal-agent/core': resolve(process.cwd(), 'packages/core/src/index.ts'),
      '@personal-agent/daemon': resolve(process.cwd(), 'packages/daemon/src/index.ts'),
      '@personal-agent/resources': resolve(process.cwd(), 'packages/resources/src/index.ts'),
      '@personal-agent/gateway': resolve(process.cwd(), 'packages/gateway/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['vitest.setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.taskfactory/**',
    ],
    coverage: {
      include: [
        'packages/*/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/node_modules/**',
        '**/dist/**',
        'packages/**/src/**/types.ts',
        'packages/cli/src/index.ts',
        'packages/gateway/src/index.ts',
      ],
      reporter: ['text', 'text-summary', 'json-summary'],
    },
  }
});
