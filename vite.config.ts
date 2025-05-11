import { defineConfig } from 'vite';

export default defineConfig({
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