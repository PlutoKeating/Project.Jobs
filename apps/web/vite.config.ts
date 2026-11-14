import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const api = process.env.JW_API_URL ?? 'http://127.0.0.1:5320';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 5321),
    proxy: {
      '/api/v1/stream': { target: api.replace(/^http/, 'ws'), ws: true },
      '/api': api,
      '/evidence': api,
      '/reports': api,
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1800 },
});
