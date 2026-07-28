/**
 * Schema migrations.  (Ticket 12)
 *
 * Careers outlive application versions, so the migration path is a permanent
 * part of the product rather than a development convenience.
 *
 * Three rules, all of which exist because a save is somebody's months of play:
 *   1. Migrations are numbered and applied in order. Never out of order.
 *   2. Every applied migration's checksum is recorded. If a file changes after
 *      it has shipped, migration refuses to run rather than guessing.
 *   3. Each migration is one transaction. A crash leaves the save at the last
 *      complete version, never half-way between two.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly applied_at: number;
}

export interface MigrationResult {
  readonly from: number;
  readonly to: number;
  readonly applied: readonly number[];
}

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'checksum_mismatch'
      | 'out_of_order'
      | 'unknown_applied'
      | 'duplicate_version'
      | 'bad_filename',
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

const FILENAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function checksum(sql: string): string {
  // Line endings are normalised first: a checkout on Windows must not invalidate
  // migrations that were authored on Linux.
  return crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  if (!fs.existsSync(dir)) return [];
  const seen = new Set<number>();
  const migrations: Migration[] = [];

  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.sql')) continue;
    const match = FILENAME.exec(file);
    if (!match) {
      throw new MigrationError(
        `Migration filename "${file}" must look like 0001_snake_case_name.sql`,
        'bad_filename',
      );
    }
    const version = Number(match[1]);
    if (seen.has(version)) {
      throw new MigrationError(`Two migrations share version ${version}`, 'duplicate_version');
    }
    seen.add(version);
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    migrations.push({ version, name: match[2] as string, sql, checksum: checksum(sql) });
  }

  return migrations.sort((a, b) => a.version - b.version);
}

function ensureLedger(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS save_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      checksum   TEXT    NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);
}

export function appliedMigrations(db: Db): AppliedMigration[] {
  ensureLedger(db);
  return db.all<AppliedMigration>('SELECT version, name, checksum, applied_at FROM save_migrations ORDER BY version');
}

export function schemaVersion(db: Db): number {
  const applied = appliedMigrations(db);
  return applied.length === 0 ? 0 : (applied[applied.length - 1] as AppliedMigration).version;
}

/**
 * Brings a database up to the newest available migration.
 *
 * `now` is a parameter rather than a call to Date.now() so that tests — and the
 * determinism rules the rest of the codebase lives under — stay honest.
 */
export function migrate(
  db: Db,
  options: { readonly dir?: string; readonly now?: number; readonly targetVersion?: number } = {},
): MigrationResult {
  const dir = options.dir ?? MIGRATIONS_DIR;
  const now = options.now ?? Date.now();
  const available = loadMigrations(dir);
  const applied = appliedMigrations(db);
  const appliedByVersion = new Map(applied.map((a) => [a.version, a]));

  // 1. Nothing may have been applied that we no longer recognise. That means the
  //    save came from a newer build, and downgrading silently would destroy it.
  const availableVersions = new Set(available.map((m) => m.version));
  for (const a of applied) {
    if (!availableVersions.has(a.version)) {
      throw new MigrationError(
        `This save has migration ${a.version} (${a.name}) applied, which this build does not know about. ` +
          `It was probably created by a newer version of Tenure. Update the app rather than opening it here.`,
        'unknown_applied',
      );
    }
  }

  // 2. Anything already applied must still hash the same.
  for (const m of available) {
    const a = appliedByVersion.get(m.version);
    if (a && a.checksum !== m.checksum) {
      throw new MigrationError(
        `Migration ${m.version} (${m.name}) has changed since it was applied to this save. ` +
          `Shipped migrations are immutable — add a new one instead of editing ${String(m.version).padStart(4, '0')}.`,
        'checksum_mismatch',
      );
    }
  }

  // 3. No gaps: applying 3 when 2 was skipped would leave an unknown schema.
  const pending = available
    .filter((m) => !appliedByVersion.has(m.version))
    .filter((m) => options.targetVersion === undefined || m.version <= options.targetVersion);

  const highestApplied = schemaVersion(db);
  for (const m of pending) {
    if (m.version < highestApplied) {
      throw new MigrationError(
        `Migration ${m.version} (${m.name}) is unapplied but this save is already at version ${highestApplied}. ` +
          `Migrations must not be inserted below the current version.`,
        'out_of_order',
      );
    }
  }

  const appliedNow: number[] = [];
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql);
      db.run(
        'INSERT INTO save_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
        m.version,
        m.name,
        m.checksum,
        now,
      );
    });
    appliedNow.push(m.version);
  }

  return { from: highestApplied, to: schemaVersion(db), applied: appliedNow };
}

/** True when the database is at the newest migration this build ships. */
export function isUpToDate(db: Db, dir: string = MIGRATIONS_DIR): boolean {
  const available = loadMigrations(dir);
  if (available.length === 0) return true;
  const newest = available[available.length - 1] as Migration;
  return schemaVersion(db) === newest.version;
}
