import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const source = path.resolve(
  desktopDirectory,
  '../../packages/persistence/migrations',
);
const destination = path.join(
  desktopDirectory,
  'dist-electron/main/migrations',
);

fs.cpSync(source, destination, { recursive: true });
