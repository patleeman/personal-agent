import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      '@personal-agent/extensions/host': resolve(__dirname, 'src/extensions/host.ts'),
      '@personal-agent/extensions/ui': resolve(__dirname, 'src/extensions/ui.ts'),
      '@personal-agent/extensions/workbench': resolve(__dirname, 'src/extensions/workbench.ts'),
      '@personal-agent/extensions/data': resolve(__dirname, 'src/extensions/data.ts'),
      '@personal-agent/extensions/settings': resolve(__dirname, 'src/extensions/settings.ts'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3741',
        changeOrigin: true,
      },
    },
  },
});
