import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: 'app',
  plugins: [react()],
  define: { global: 'globalThis' },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
      buffer: 'buffer',
    },
  },
  optimizeDeps: { include: ['buffer'] },
  server: { port: 5173, host: true },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1600 },
});
