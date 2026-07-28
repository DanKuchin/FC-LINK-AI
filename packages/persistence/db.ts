/**
 * The database adapter.  (part of Ticket 12)
 *
 * Everything that touches SQLite goes through this interface, so the driver
 * stays a one-file decision. Today it is Node's built-in `node:sqlite`, which
 * means no native compilation and no `electron-rebuild` step. If Electron's
 * bundled Node ever lacks it, swapping in `better-sqlite3` is a change to this
 * file and nothing else — both expose the same synchronous shape.
 *
 * Synchronous on purpose: the simulation is a tick loop, and `await` inside a
 * tick would make ordering — and therefore determinism — a matter of scheduling.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type Database, type Statement } from './sqlite-runtime.js';

export type SqlParam = string | number | bigint | null | Uint8Array;
export type Row = Record<string, unknown>;

export interface RunResult {
  readonly changes: number;
  readonly lastInsertRowid: number;
}

export interface Db {
  readonly path: string;
  exec(sql: string): void;
  run(sql: string, ...params: SqlParam[]): RunResult;
  get<T = Row>(sql: string, ...params: SqlParam[]): T | undefined;
  all<T = Row>(sql: string, ...params: SqlParam[]): T[];
  /** Runs `fn` in a transaction, nesting safely via savepoints. Rolls back on throw. */
  transaction<T>(fn: () => T): T;
  pragma(statement: string): Row[];
  /** `PRAGMA integrity_check` — returns null when the file is sound. */
  integrityProblem(): string | null;
  close(): void;
}

export interface OpenOptions {
  /** Create parent directories if they are missing. Default true. */
  readonly createDirectory?: boolean;
  /** WAL keeps readers from blocking the tick loop. Off for `:memory:`. Default true. */
  readonly wal?: boolean;
  /** Foreign keys are OFF by default in SQLite. We always want them on. Default true. */
  readonly foreignKeys?: boolean;
}

class NodeSqliteDb implements Db {
  readonly path: string;

  private readonly db: Database;
  private readonly statements = new Map<string, Statement>();
  private savepointDepth = 0;
  private closed = false;

  constructor(filePath: string, options: OpenOptions = {}) {
    this.path = filePath;
    const inMemory = filePath === ':memory:';
    if (!inMemory && options.createDirectory !== false) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    this.db = new DatabaseSync(filePath);
    if (options.foreignKeys !== false) this.db.exec('PRAGMA foreign_keys = ON');
    if (!inMemory && options.wal !== false) {
      this.db.exec('PRAGMA journal_mode = WAL');
      // FULL is slower than NORMAL but survives an OS crash, not just a process
      // crash. A corrupted career is the worst outcome this product has.
      this.db.exec('PRAGMA synchronous = FULL');
    }
    this.db.exec('PRAGMA busy_timeout = 5000');
  }

  private stmt(sql: string): Statement {
    let s = this.statements.get(sql);
    if (s === undefined) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, ...params: SqlParam[]): RunResult {
    const r = this.stmt(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  get<T = Row>(sql: string, ...params: SqlParam[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: SqlParam[]): T[] {
    return this.stmt(sql).all(...params) as T[];
  }

  transaction<T>(fn: () => T): T {
    const top = this.savepointDepth === 0;
    const name = `sp_${this.savepointDepth}`;
    this.db.exec(top ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
    this.savepointDepth += 1;
    try {
      const result = fn();
      this.savepointDepth -= 1;
      this.db.exec(top ? 'COMMIT' : `RELEASE ${name}`);
      return result;
    } catch (error) {
      this.savepointDepth -= 1;
      try {
        this.db.exec(top ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
      } catch {
        // The rollback itself failing means the connection is already unusable;
        // surface the original error, which is the one worth reading.
      }
      throw error;
    }
  }

  pragma(statement: string): Row[] {
    return this.db.prepare(`PRAGMA ${statement}`).all() as Row[];
  }

  integrityProblem(): string | null {
    const rows = this.pragma('integrity_check');
    const first = rows[0]?.integrity_check;
    return first === 'ok' ? null : String(first ?? 'unknown integrity failure');
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.statements.clear();
    // WAL content must be folded back into the main file, or a checkpoint copy
    // taken afterwards would silently omit the most recent writes.
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* :memory: and read-only handles have no WAL */
    }
    this.db.close();
  }
}

export function openDatabase(dbPath: string, options?: OpenOptions): Db {
  return new NodeSqliteDb(dbPath, options ?? {});
}

/** An in-memory database. Tests use this; the application never should. */
export function openMemoryDatabase(): Db {
  return new NodeSqliteDb(':memory:', {});
}
