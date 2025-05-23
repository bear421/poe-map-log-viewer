import { defineConfig } from 'vite';

export default defineConfig({
  base: '/poe-map-log-viewer/',
  root: 'src',
  build: {
    outDir: '../dist',
    worker: {
      format: 'es'
    }
  },
  server: {
    watch: {
      usePolling: true,
    },
    hmr: {
      overlay: true,
    }
  }
}); 