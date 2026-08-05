import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['dist', 'dist-electron']) {
  const target = path.join(desktopRoot, name);
  if (path.dirname(target) !== desktopRoot) {
    throw new Error(`Refusing to clean unexpected path: ${target}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
}
