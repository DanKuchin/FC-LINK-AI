/**
 * Loads the SQLite driver at runtime.
 *
 * Two reasons this is not a plain `import`:
 *   1. Bundlers (Vite, and therefore Vitest) do not yet recognise `node:sqlite`
 *      as a builtin and try to resolve it from disk. `createRequire` sidesteps
 *      static analysis entirely.
 *   2. It puts the whole "which SQLite" decision in one twelve-line file, which
 *      is exactly where it belongs if we ever move to better-sqlite3.
 *
 * The type import is erased at compile time, so it costs nothing at runtime.
 */

import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType, StatementSync as StatementSyncType } from 'node:sqlite';

const require = createRequire(import.meta.url);

interface SqliteModule {
  DatabaseSync: new (path: string, options?: Record<string, unknown>) => DatabaseSyncType;
}

const sqlite = require('node:sqlite') as SqliteModule;

export const DatabaseSync = sqlite.DatabaseSync;
export type Database = DatabaseSyncType;
export type Statement = StatementSyncType;
