import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

export default defineConfig({
  resolve: {
    alias: {
      '@tenure/sync': path.join(repositoryRoot, 'packages/sync'),
    },
  },
  build: {
    target: 'node24',
    outDir: 'dist-electron/main',
    emptyOutDir: false,
    lib: {
      entry: 'src/main/main.ts',
      formats: ['es'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: ['electron', /^node:/],
    },
  },
});
