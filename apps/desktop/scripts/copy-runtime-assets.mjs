import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const migrationsSource = path.resolve(
  desktopDirectory,
  '../../packages/persistence/migrations',
);
const migrationsDestination = path.join(
  desktopDirectory,
  'dist-electron/main/migrations',
);
const bridgeSource = path.resolve(desktopDirectory, '../../bridge');
const bridgeDestination = path.join(desktopDirectory, 'dist-electron/main/bridge');

fs.cpSync(migrationsSource, migrationsDestination, { recursive: true });
fs.cpSync(bridgeSource, bridgeDestination, { recursive: true });
