import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, openMemoryDatabase, type Db } from './db.js';
import {
  MIGRATIONS_DIR,
  MigrationError,
  appliedMigrations,
  checksum,
  isUpToDate,
  loadMigrations,
  migrate,
  schemaVersion,
} from './migrate.js';
import {
  createCheckpoint,
  listCheckpoints,
  pruneCheckpoints,
  restoreCheckpoint,
  verifyCheckpoint,
} from './checkpoints.js';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tenure-test-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A throwaway migration set, so schema tests do not depend on the real one. */
function fakeMigrations(dir: string, files: Record<string, string>): string {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

describe('Db', () => {
  it('round-trips values and reports changes', () => {
    const db = openMemoryDatabase();
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    const result = db.run('INSERT INTO t (name) VALUES (?)', 'Bilbao');
    expect(result.changes).toBe(1);
    expect(result.lastInsertRowid).toBe(1);
    expect(db.get<{ name: string }>('SELECT name FROM t WHERE id = ?', 1)?.name).toBe('Bilbao');
    expect(db.all('SELECT * FROM t')).toHaveLength(1);
    db.close();
  });

  it('enforces foreign keys', () => {
    const db = openMemoryDatabase();
    db.exec('CREATE TABLE a (id INTEGER PRIMARY KEY)');
    db.exec('CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(id))');
    expect(() => db.run('INSERT INTO b (a_id) VALUES (?)', 99)).toThrow();
    db.close();
  });

  it('rolls a transaction back on throw', () => {
    const db = openMemoryDatabase();
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    expect(() =>
      db.transaction(() => {
        db.run('INSERT INTO t (id) VALUES (1)');
        throw new Error('nope');
      }),
    ).toThrow('nope');
    expect(db.all('SELECT * FROM t')).toHaveLength(0);
    db.close();
  });

  it('nests transactions with savepoints — the inner failure does not lose the outer work', () => {
    const db = openMemoryDatabase();
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    db.transaction(() => {
      db.run('INSERT INTO t (id) VALUES (1)');
      try {
        db.transaction(() => {
          db.run('INSERT INTO t (id) VALUES (2)');
          throw new Error('inner');
        });
      } catch {
        /* handled */
      }
      db.run('INSERT INTO t (id) VALUES (3)');
    });
    expect(db.all<{ id: number }>('SELECT id FROM t ORDER BY id').map((r) => r.id)).toEqual([1, 3]);
    db.close();
  });

  it('opens on disk in WAL mode and reports integrity', () => {
    const file = path.join(tmp, 'nested', 'career.db');
    const db = openDatabase(file);
    expect(fs.existsSync(file)).toBe(true);
    expect(db.pragma('journal_mode')[0]?.journal_mode).toBe('wal');
    expect(db.integrityProblem()).toBeNull();
    db.close();
  });
});

describe('migrations — the real schema', () => {
  it('applies cleanly to an empty database', () => {
    const db = openMemoryDatabase();
    const result = migrate(db, { now: 1 });
    expect(result.from).toBe(0);
    expect(result.to).toBeGreaterThan(0);
    expect(isUpToDate(db)).toBe(true);
    db.close();
  });

  it('creates every table the data model promises', () => {
    const db = openMemoryDatabase();
    migrate(db, { now: 1 });
    const names = new Set(
      db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name),
    );
    for (const expected of [
      'careers', 'seasons', 'competitions', 'clubs', 'players', 'player_attributes',
      'player_personalities', 'staff', 'contracts', 'promises', 'board_members',
      'board_objectives', 'fixtures', 'match_results', 'player_match_stats',
      'transfer_negotiations', 'transfer_transactions', 'scouting_assignments',
      'scouting_reports', 'relationships', 'narrative_events', 'messages',
      'financial_transactions', 'sim_events', 'historical_records', 'scheduled_events',
      'sync_snapshots', 'sync_operations', 'external_id_mappings', 'sync_divergences',
      'save_migrations',
    ]) {
      expect(names, `missing table: ${expected}`).toContain(expected);
    }
    db.close();
  });

  it('is idempotent — running it twice changes nothing', () => {
    const db = openMemoryDatabase();
    migrate(db, { now: 1 });
    const second = migrate(db, { now: 2 });
    expect(second.applied).toEqual([]);
    expect(appliedMigrations(db)).toHaveLength(loadMigrations().length);
    db.close();
  });

  it('every migration filename is well formed', () => {
    expect(loadMigrations(MIGRATIONS_DIR).length).toBeGreaterThan(0);
    for (const m of loadMigrations(MIGRATIONS_DIR)) {
      expect(m.version).toBeGreaterThan(0);
      expect(m.name).toMatch(/^[a-z0-9_]+$/);
    }
  });
});

describe('migrations — invariants that live in the schema', () => {
  function seededCareer(): Db {
    const db = openMemoryDatabase();
    migrate(db, { now: 1 });
    db.run(
      `INSERT INTO careers (id, name, save_uid, master_seed, current_date, schema_version, created_at, updated_at)
       VALUES (1, 'Test', 'uid-1', 'seed', 20000, 1, 0, 0)`,
    );
    db.run(
      `INSERT INTO clubs (id, career_id, name, created_at, updated_at) VALUES (1, 1, 'Club A', 0, 0)`,
    );
    db.run(
      `INSERT INTO players (id, career_id, club_id, birth_date, primary_position, created_at, updated_at)
       VALUES (1, 1, 1, 10000, 'ST', 0, 0)`,
    );
    return db;
  }

  it('refuses a second active permanent contract for the same player', () => {
    const db = seededCareer();
    const insert = (id: number, kind: string, status: string) =>
      db.run(
        `INSERT INTO contracts (id, career_id, player_id, club_id, kind, start_date, end_date, status)
         VALUES (?, 1, 1, 1, ?, 20000, 21000, ?)`,
        id, kind, status,
      );

    insert(1, 'permanent', 'active');
    expect(() => insert(2, 'permanent', 'active')).toThrow();
    // An expired one alongside an active one is fine — that is career history.
    expect(() => insert(3, 'permanent', 'expired')).not.toThrow();
    // A loan alongside a permanent is fine — that is how loans work.
    expect(() => insert(4, 'loan', 'active')).not.toThrow();
    db.close();
  });

  it('refuses a duplicate simulation event key — this is what makes replay safe', () => {
    const db = seededCareer();
    const insert = () =>
      db.run(
        `INSERT INTO sim_events (career_id, event_key, tick, occurred_on, kind)
         VALUES (1, 'day:20001:injury:7', 1, 20001, 'injury')`,
      );
    insert();
    expect(insert).toThrow();
    db.close();
  });

  it('a narrative event cannot exist without a simulation event', () => {
    const db = seededCareer();
    expect(() =>
      db.run(
        `INSERT INTO narrative_events (career_id, sim_event_id, channel, headline, body, generator, occurred_on)
         VALUES (1, 999, 'news', 'h', 'b', 'template', 20001)`,
      ),
    ).toThrow();
    db.close();
  });

  it('rejects a scouting report whose range is inverted', () => {
    const db = seededCareer();
    expect(() =>
      db.run(
        `INSERT INTO scouting_reports (career_id, player_id, ability_low, ability_high,
                                       potential_low, potential_high, confidence, written_on)
         VALUES (1, 1, 90, 40, 50, 60, 0.5, 20000)`,
      ),
    ).toThrow();
    db.close();
  });

  it('balance is the sum of transactions, never a stored number', () => {
    const db = seededCareer();
    const add = (amount: number, category: string) =>
      db.run(
        `INSERT INTO financial_transactions (career_id, club_id, amount, category, occurred_on, description)
         VALUES (1, 1, ?, ?, 20000, 'test')`,
        amount, category,
      );
    add(10_000_000, 'sponsor');
    add(-2_500_000, 'wages');
    add(-1_000_000, 'transfer_fee');
    const balance = db.get<{ b: number }>(
      'SELECT COALESCE(SUM(amount), 0) AS b FROM financial_transactions WHERE club_id = 1',
    );
    expect(balance?.b).toBe(6_500_000);
    db.close();
  });
});

describe('migrations — safety rails', () => {
  it('refuses a migration that changed after it was applied', () => {
    const dir = fakeMigrations(path.join(tmp, 'm1'), {
      '0001_init.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
    });
    const file = path.join(tmp, 'save.db');
    let db = openDatabase(file);
    migrate(db, { dir, now: 1 });
    db.close();

    fs.writeFileSync(path.join(dir, '0001_init.sql'), 'CREATE TABLE a (id INTEGER PRIMARY KEY, extra TEXT);');
    db = openDatabase(file);
    expect(() => migrate(db, { dir, now: 2 })).toThrow(MigrationError);
    try {
      migrate(db, { dir, now: 2 });
    } catch (e) {
      expect((e as MigrationError).code).toBe('checksum_mismatch');
    }
    db.close();
  });

  it('refuses a migration inserted below the current version', () => {
    const dir = path.join(tmp, 'm2');
    fakeMigrations(dir, {
      '0001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
      '0003_c.sql': 'CREATE TABLE c (id INTEGER PRIMARY KEY);',
    });
    const db = openMemoryDatabase();
    migrate(db, { dir, now: 1 });
    fs.writeFileSync(path.join(dir, '0002_b.sql'), 'CREATE TABLE b (id INTEGER PRIMARY KEY);');
    expect(() => migrate(db, { dir, now: 2 })).toThrow(/must not be inserted below/);
    db.close();
  });

  it('refuses to open a save from a newer build', () => {
    const dir = fakeMigrations(path.join(tmp, 'm3'), {
      '0001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
      '0002_b.sql': 'CREATE TABLE b (id INTEGER PRIMARY KEY);',
    });
    const file = path.join(tmp, 'future.db');
    let db = openDatabase(file);
    migrate(db, { dir, now: 1 });
    db.close();

    // Simulate this build only shipping migration 1.
    fs.rmSync(path.join(dir, '0002_b.sql'));
    db = openDatabase(file);
    expect(() => migrate(db, { dir, now: 2 })).toThrow(/newer version of Tenure/);
    db.close();
  });

  it('rejects a badly named migration file', () => {
    const dir = fakeMigrations(path.join(tmp, 'm4'), { 'init.sql': 'SELECT 1;' });
    expect(() => loadMigrations(dir)).toThrow(/snake_case/);
  });

  it('an old save opens after later migrations are added', () => {
    const dir = path.join(tmp, 'm5');
    fakeMigrations(dir, { '0001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);' });
    const file = path.join(tmp, 'old.db');
    let db = openDatabase(file);
    migrate(db, { dir, now: 1 });
    db.run("INSERT INTO a (id) VALUES (42)");
    db.close();

    fs.writeFileSync(path.join(dir, '0002_b.sql'), 'ALTER TABLE a ADD COLUMN note TEXT;');
    fs.writeFileSync(path.join(dir, '0003_c.sql'), 'CREATE TABLE c (id INTEGER PRIMARY KEY);');
    db = openDatabase(file);
    const result = migrate(db, { dir, now: 2 });
    expect(result.from).toBe(1);
    expect(result.to).toBe(3);
    expect(db.get<{ id: number }>('SELECT id FROM a')?.id).toBe(42); // data survived
    db.close();
  });

  it('leaves the version untouched when a migration fails half-way', () => {
    const dir = fakeMigrations(path.join(tmp, 'm6'), {
      '0001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
      '0002_bad.sql': 'CREATE TABLE b (id INTEGER PRIMARY KEY); THIS IS NOT SQL;',
    });
    const db = openMemoryDatabase();
    expect(() => migrate(db, { dir, now: 1 })).toThrow();
    expect(schemaVersion(db)).toBe(1);
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
    expect(tables).not.toContain('b'); // the partial migration was rolled back
    db.close();
  });

  it('normalises line endings when hashing, so a Windows checkout still matches', () => {
    expect(checksum('CREATE TABLE a;\nCREATE TABLE b;\n')).toBe(
      checksum('CREATE TABLE a;\r\nCREATE TABLE b;\r\n'),
    );
  });
});

describe('checkpoints', () => {
  function careerAt(file: string): Db {
    const db = openDatabase(file);
    migrate(db, { now: 1 });
    db.run(
      `INSERT INTO careers (id, name, save_uid, master_seed, current_date, schema_version, created_at, updated_at)
       VALUES (1, 'Test', 'uid-1', 'seed', 20000, 1, 0, 0)`,
    );
    return db;
  }

  it('creates a verifiable checkpoint and lists it', () => {
    const file = path.join(tmp, 'career.db');
    const dir = path.join(tmp, 'checkpoints');
    const db = careerAt(file);
    const info = createCheckpoint(db, { dir, reason: 'career_created', careerId: 1, now: 1000 });
    db.close();

    expect(fs.existsSync(info.dbPath)).toBe(true);
    expect(info.bytes).toBeGreaterThan(0);
    expect(verifyCheckpoint(info)).toEqual({ ok: true });
    expect(listCheckpoints(dir).map((c) => c.id)).toEqual([info.id]);
  });

  it('detects a tampered checkpoint instead of restoring it', () => {
    const file = path.join(tmp, 'career.db');
    const dir = path.join(tmp, 'checkpoints');
    const db = careerAt(file);
    const info = createCheckpoint(db, { dir, reason: 'manual', now: 1000 });
    db.close();

    fs.appendFileSync(info.dbPath, 'corruption');
    const verdict = verifyCheckpoint(info);
    expect(verdict.ok).toBe(false);
    expect(() => restoreCheckpoint(info, file)).toThrow(/Refusing to restore/);
  });

  it('restores a career to an earlier state and keeps a safety copy', () => {
    const file = path.join(tmp, 'career.db');
    const dir = path.join(tmp, 'checkpoints');

    let db = careerAt(file);
    const info = createCheckpoint(db, { dir, reason: 'pre_match', careerId: 1, now: 1000 });
    // Something goes wrong after the checkpoint.
    db.run("UPDATE careers SET name = 'ruined', current_date = 99999 WHERE id = 1");
    db.close();

    db = openDatabase(file);
    expect(db.get<{ name: string }>('SELECT name FROM careers')?.name).toBe('ruined');
    db.close();

    const result = restoreCheckpoint(info, file, { now: 2000 });
    expect(fs.existsSync(result.safetyCopy)).toBe(true);

    db = openDatabase(file);
    expect(db.get<{ name: string }>('SELECT name FROM careers')?.name).toBe('Test');
    expect(db.integrityProblem()).toBeNull();
    db.close();
  });

  it('clears stale WAL sidecars on restore', () => {
    const file = path.join(tmp, 'career.db');
    const dir = path.join(tmp, 'checkpoints');
    const db = careerAt(file);
    const info = createCheckpoint(db, { dir, reason: 'manual', now: 1000 });
    db.run("UPDATE careers SET name = 'later' WHERE id = 1");
    db.close();

    fs.writeFileSync(`${file}-wal`, 'stale journal');
    restoreCheckpoint(info, file, { now: 2000 });
    expect(fs.existsSync(`${file}-wal`)).toBe(false);
  });

  it('applies retention per reason and never prunes the permanent ones', () => {
    const file = path.join(tmp, 'career.db');
    const dir = path.join(tmp, 'checkpoints');
    const db = careerAt(file);
    for (let i = 0; i < 8; i += 1) {
      createCheckpoint(db, { dir, reason: 'pre_match', now: 1000 + i });
    }
    for (let i = 0; i < 3; i += 1) {
      createCheckpoint(db, { dir, reason: 'career_created', now: 2000 + i });
    }
    db.close();

    const removed = pruneCheckpoints(dir);
    const left = listCheckpoints(dir);
    expect(removed).toHaveLength(3); // 8 pre_match, keep 5
    expect(left.filter((c) => c.reason === 'pre_match')).toHaveLength(5);
    expect(left.filter((c) => c.reason === 'career_created')).toHaveLength(3);
    // The five kept are the newest five.
    const kept = left.filter((c) => c.reason === 'pre_match').map((c) => c.createdAt).sort();
    expect(kept).toEqual([1003, 1004, 1005, 1006, 1007]);
  });
});
