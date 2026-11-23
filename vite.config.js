import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    proxy: {
      '/api': {
        target: process.env.BETAF_API_TARGET || 'http://127.0.0.1:3001',
        changeOrigin: true
      }
    }
  }
});
