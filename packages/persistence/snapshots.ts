import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db.js';

export interface ArchiveSnapshotOptions {
  readonly careerId: number;
  readonly directory: string;
  readonly reason: string;
  readonly payload: string | Uint8Array;
  readonly takenAt: number;
  readonly protocol: number;
  readonly gameBuild?: string | null;
  readonly liveEditorVersion?: string | null;
  readonly inGameDate?: number | null;
  readonly entityCounts?: Readonly<Record<string, number>>;
}

export interface SnapshotRecord {
  readonly id: number;
  readonly career_id: number;
  readonly taken_at: number;
  readonly reason: string;
  readonly game_build: string | null;
  readonly le_version: string | null;
  readonly protocol: number;
  readonly in_game_date: number | null;
  readonly checksum: string;
  readonly raw_path: string;
  readonly entity_counts_json: string;
}

export interface ArchivedSnapshot {
  readonly record: SnapshotRecord;
  readonly bytes: number;
}

export class SnapshotArchiveError extends Error {
  constructor(
    message: string,
    readonly code: 'missing' | 'checksum_mismatch' | 'invalid_counts',
  ) {
    super(message);
    this.name = 'SnapshotArchiveError';
  }
}

function snapshotBytes(payload: string | Uint8Array): Buffer {
  return typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);
}

function checksum(bytes: Uint8Array): string {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function validateCounts(counts: Readonly<Record<string, number>>): void {
  for (const [entity, count] of Object.entries(counts)) {
    if (entity.length === 0 || !Number.isInteger(count) || count < 0) {
      throw new SnapshotArchiveError(
        `entity count ${entity || '(empty)'} must be a non-negative integer`,
        'invalid_counts',
      );
    }
  }
}

export function archiveSnapshot(db: Db, options: ArchiveSnapshotOptions): ArchivedSnapshot {
  if (!Number.isInteger(options.careerId) || options.careerId < 1) {
    throw new Error('careerId must be a positive integer');
  }
  if (!Number.isInteger(options.takenAt) || options.takenAt < 0) {
    throw new Error('takenAt must be a non-negative integer');
  }
  if (!Number.isInteger(options.protocol) || options.protocol < 1) {
    throw new Error('protocol must be a positive integer');
  }
  const counts = options.entityCounts ?? {};
  validateCounts(counts);
  const bytes = snapshotBytes(options.payload);
  const digest = checksum(bytes);
  const filename = [
    `career-${options.careerId}`,
    String(options.takenAt).padStart(13, '0'),
    digest.slice('sha256:'.length, 'sha256:'.length + 16),
  ].join('-') + '.snapshot';
  fs.mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  const target = path.resolve(options.directory, filename);
  const temporary = `${target}.${crypto.randomBytes(8).toString('hex')}.tmp`;

  try {
    fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // See handshake.ts: the containing LOCALAPPDATA directory is the Windows
      // access boundary when POSIX modes are unavailable.
    }

    const id = db.transaction(() => db.run(
      `INSERT INTO sync_snapshots (
        career_id, taken_at, reason, game_build, le_version, protocol,
        in_game_date, checksum, raw_path, entity_counts_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      options.careerId,
      options.takenAt,
      options.reason,
      options.gameBuild ?? null,
      options.liveEditorVersion ?? null,
      options.protocol,
      options.inGameDate ?? null,
      digest,
      target,
      JSON.stringify(counts),
    ).lastInsertRowid);
    const record = db.get<SnapshotRecord>(
      'SELECT * FROM sync_snapshots WHERE id = ?',
      id,
    );
    if (record === undefined) throw new Error(`snapshot row ${id} was not created`);
    return { record, bytes: bytes.length };
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Nothing temporary remains.
    }
    try {
      fs.unlinkSync(target);
    } catch {
      // The target may not have been installed yet.
    }
    throw error;
  }
}

export function loadArchivedSnapshot(record: SnapshotRecord): Buffer {
  if (!fs.existsSync(record.raw_path)) {
    throw new SnapshotArchiveError(
      `raw snapshot ${record.raw_path} is missing`,
      'missing',
    );
  }
  const bytes = fs.readFileSync(record.raw_path);
  const actual = checksum(bytes);
  if (actual !== record.checksum) {
    throw new SnapshotArchiveError(
      `raw snapshot checksum mismatch: expected ${record.checksum}, received ${actual}`,
      'checksum_mismatch',
    );
  }
  return bytes;
}

export function verifyArchivedSnapshot(record: SnapshotRecord): SnapshotArchiveError | null {
  try {
    loadArchivedSnapshot(record);
    return null;
  } catch (error) {
    if (error instanceof SnapshotArchiveError) return error;
    throw error;
  }
}
