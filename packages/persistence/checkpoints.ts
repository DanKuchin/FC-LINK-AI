/**
 * Checkpoints.  (Ticket 13)
 *
 * A checkpoint is a complete, restorable copy of a career at a named moment.
 * They are cheap (`VACUUM INTO` writes a compacted single file) and they are the
 * reason the product can afford to touch a live football save at all.
 *
 * Restoring is a first-class user action, not a support procedure — so it is
 * implemented with the same care as a write: verify first, keep a safety copy,
 * and never leave the target in a half-replaced state.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDatabase, type Db } from './db.js';

/** Why a checkpoint was taken. Drives retention. */
export type CheckpointReason =
  | 'career_created'
  | 'pre_launch'
  | 'career_loaded'
  | 'pre_match'
  | 'post_match'
  | 'window_close'
  | 'pre_rollover'
  | 'post_rollover'
  | 'pre_write_batch'
  | 'pre_migration'
  | 'manual';

/** How many of each kind to keep. Anything not listed keeps 3. */
export const RETENTION: Readonly<Record<CheckpointReason, number>> = {
  career_created: Infinity,
  pre_rollover: Infinity,
  post_rollover: Infinity,
  pre_launch: 3,
  career_loaded: 3,
  pre_match: 5,
  post_match: 5,
  window_close: 4,
  pre_write_batch: 10,
  pre_migration: 3,
  manual: Infinity,
};

export interface CheckpointInfo {
  readonly id: string;
  readonly reason: CheckpointReason;
  readonly label: string;
  readonly createdAt: number;
  readonly schemaVersion: number;
  readonly careerId: number | null;
  readonly inGameDate: number | null;
  readonly bytes: number;
  readonly checksum: string;
  readonly dbPath: string;
  readonly manifestPath: string;
}

export interface CreateCheckpointOptions {
  readonly dir: string;
  readonly reason: CheckpointReason;
  readonly label?: string;
  readonly careerId?: number | null;
  readonly inGameDate?: number | null;
  readonly now?: number;
}

const WAL_SIDECARS = ['-wal', '-shm'] as const;

function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 60);
}

function readSchemaVersion(db: Db): number {
  try {
    const row = db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM save_migrations');
    return row?.v ?? 0;
  } catch {
    return 0; // ledger not created yet
  }
}

/**
 * Takes a checkpoint of the open database.
 *
 * `VACUUM INTO` produces a transactionally consistent copy including anything
 * still sitting in the WAL, so no flush dance is needed — but it does require
 * that no transaction is open on this connection.
 */
export function createCheckpoint(db: Db, options: CreateCheckpointOptions): CheckpointInfo {
  const now = options.now ?? Date.now();
  const label = options.label ?? options.reason;
  const id = `${new Date(now).toISOString().replace(/[:.]/g, '-')}_${safeSegment(options.reason)}_${crypto
    .randomBytes(3)
    .toString('hex')}`;

  fs.mkdirSync(options.dir, { recursive: true });
  const dbPath = path.join(options.dir, `${id}.db`);
  const manifestPath = path.join(options.dir, `${id}.json`);

  // Single quotes are the SQL string delimiter; doubling escapes them.
  db.exec(`VACUUM INTO '${dbPath.replace(/'/g, "''")}'`);

  const info: CheckpointInfo = {
    id,
    reason: options.reason,
    label,
    createdAt: now,
    schemaVersion: readSchemaVersion(db),
    careerId: options.careerId ?? null,
    inGameDate: options.inGameDate ?? null,
    bytes: fs.statSync(dbPath).size,
    checksum: sha256File(dbPath),
    dbPath,
    manifestPath,
  };

  const tmp = `${manifestPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(info, null, 2));
  fs.renameSync(tmp, manifestPath);

  return info;
}

export function listCheckpoints(dir: string): CheckpointInfo[] {
  if (!fs.existsSync(dir)) return [];
  const out: CheckpointInfo[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    try {
      const info = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as CheckpointInfo;
      if (fs.existsSync(info.dbPath)) out.push(info);
    } catch {
      // A manifest we cannot parse is not a reason to hide the ones we can.
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export type VerifyResult = { readonly ok: true } | { readonly ok: false; readonly problem: string };

/** Confirms a checkpoint is present, unmodified, and a readable SQLite database. */
export function verifyCheckpoint(info: CheckpointInfo): VerifyResult {
  if (!fs.existsSync(info.dbPath)) return { ok: false, problem: 'checkpoint file is missing' };
  if (sha256File(info.dbPath) !== info.checksum) {
    return { ok: false, problem: 'checkpoint file has been modified since it was written' };
  }
  let db: Db | undefined;
  try {
    db = openDatabase(info.dbPath, { wal: false });
    const problem = db.integrityProblem();
    return problem === null ? { ok: true } : { ok: false, problem };
  } catch (error) {
    return { ok: false, problem: `cannot open checkpoint: ${(error as Error).message}` };
  } finally {
    db?.close();
  }
}

export interface RestoreResult {
  readonly restoredFrom: string;
  readonly safetyCopy: string;
}

/**
 * Replaces `targetPath` with a checkpoint.
 *
 * The caller must have closed the target database first. The stale `-wal` and
 * `-shm` sidecars are deleted: leaving them beside a replaced main file is a
 * genuine route to corruption, because SQLite would try to reconcile a journal
 * belonging to a database that no longer exists.
 */
export function restoreCheckpoint(
  info: CheckpointInfo,
  targetPath: string,
  options: { readonly now?: number } = {},
): RestoreResult {
  const verified = verifyCheckpoint(info);
  if (!verified.ok) throw new Error(`Refusing to restore: ${verified.problem}`);

  const now = options.now ?? Date.now();
  const safetyCopy = `${targetPath}.before-restore-${now}`;
  if (fs.existsSync(targetPath)) fs.copyFileSync(targetPath, safetyCopy);

  // Write beside the target then rename, so an interrupted copy cannot leave a
  // truncated file where the career used to be.
  const staged = `${targetPath}.restoring`;
  fs.copyFileSync(info.dbPath, staged);
  for (const suffix of WAL_SIDECARS) {
    const sidecar = `${targetPath}${suffix}`;
    if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
  }
  fs.renameSync(staged, targetPath);

  return { restoredFrom: info.id, safetyCopy };
}

/** Applies the retention policy. Returns the checkpoints that were removed. */
export function pruneCheckpoints(dir: string): CheckpointInfo[] {
  const byReason = new Map<CheckpointReason, CheckpointInfo[]>();
  for (const info of listCheckpoints(dir)) {
    const list = byReason.get(info.reason) ?? [];
    list.push(info);
    byReason.set(info.reason, list);
  }

  const removed: CheckpointInfo[] = [];
  for (const [reason, list] of byReason) {
    const keep = RETENTION[reason] ?? 3;
    if (!Number.isFinite(keep)) continue;
    for (const info of list.slice(keep)) {
      // listCheckpoints already sorted newest first, so slice(keep) is the tail.
      try {
        fs.rmSync(info.dbPath, { force: true });
        fs.rmSync(info.manifestPath, { force: true });
        removed.push(info);
      } catch {
        // A locked file is a reason to skip, not to abort the whole prune.
      }
    }
  }
  return removed;
}
