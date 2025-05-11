import { defineConfig } from 'vite';

export default defineConfig({
  base: '/poe-map-viewer/',
  build: {
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