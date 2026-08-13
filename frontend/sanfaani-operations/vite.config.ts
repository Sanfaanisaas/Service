import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: {
    port: Number(process.env.PORT || 3000), strictPort: true, host: '0.0.0.0', allowedHosts: true,
    proxy: { '/api': { target: 'http://localhost:5000', changeOrigin: true } },
  },
  preview: { port: Number(process.env.PORT || 3000), host: '0.0.0.0', allowedHosts: true },
});
