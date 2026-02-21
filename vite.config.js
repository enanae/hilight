import { defineConfig } from 'vite';

export default defineConfig({
  base: '/hilight/',
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
  },
});
