import { defineConfig } from 'vite';

export default defineConfig({
  base: '/hilight/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
  },
});
