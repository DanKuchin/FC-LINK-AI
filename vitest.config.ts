import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@tenure/domain': path.join(root, 'packages/domain'),
      '@tenure/sim': path.join(root, 'packages/sim'),
      '@tenure/sync': path.join(root, 'packages/sync'),
      '@tenure/persistence': path.join(root, 'packages/persistence'),
      '@tenure/narrative': path.join(root, 'packages/narrative'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    // The simulation must never see wall-clock time or ambient randomness.
    // Anything that needs "now" takes it as an argument.
    restoreMocks: true,
  },
});
