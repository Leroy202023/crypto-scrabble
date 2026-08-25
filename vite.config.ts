import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: 'app',
  plugins: [react()],
  resolve: {
    alias: { '@shared': path.resolve(__dirname, 'shared') },
  },
  server: { port: 5173, host: true },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1600 },
});
