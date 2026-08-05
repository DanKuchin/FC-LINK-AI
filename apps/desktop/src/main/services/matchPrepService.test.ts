import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../../../../packages/persistence/db.js';
import { migrate } from '../../../../../packages/persistence/migrate.js';
import { archiveSnapshot } from '../../../../../packages/persistence/snapshots.js';
import { MatchPrepService } from './matchPrepService.js';

let temporaryDirectory: string;
let careerPath: string;
let checkpointDirectory: string;
let snapshotDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenure-match-prep-'));
  careerPath = path.join(temporaryDirectory, 'career.db');
  checkpointDirectory = path.join(temporaryDirectory, 'checkpoints');
  snapshotDirectory = path.join(temporaryDirectory, 'snapshots');
  const db = openDatabase(careerPath);
  migrate(db, { now: 1 });
  db.run(
    `INSERT INTO careers (
      id, name, save_uid, master_seed, current_date, schema_version, created_at, updated_at
    ) VALUES (1, 'Prep', 'prep-save', 'seed', 20000, 3, 1, 1)`,
  );
  db.close();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('desktop match preparation service', () => {
  it('blocks until a checkpoint exists, then permits explicit manual mode', () => {
    const service = new MatchPrepService({
      careerPath,
      checkpointDirectory,
      now: () => 10,
    });
    expect(service.state(true).decision.allowed).toBe(false);
    const prepared = service.createCheckpoint(true);
    expect(prepared).toMatchObject({
      checkpointVerified: true,
      snapshotState: 'missing',
      decision: { allowed: true, mode: 'manual_result' },
    });
  });

  it('permits snapshot-diff mode only for current verified raw evidence', () => {
    const service = new MatchPrepService({
      careerPath,
      checkpointDirectory,
      now: () => 10,
    });
    service.createCheckpoint(false);
    const db = openDatabase(careerPath);
    archiveSnapshot(db, {
      careerId: 1,
      directory: snapshotDirectory,
      reason: 'pre_match',
      payload: '{"players":[]}',
      takenAt: 11,
      protocol: 1,
      inGameDate: 20000,
    });
    db.close();
    expect(service.state(false)).toMatchObject({
      snapshotState: 'ready',
      decision: { allowed: true, mode: 'snapshot_diff' },
    });
  });

  it('detects stale and corrupted pre-match evidence', () => {
    const service = new MatchPrepService({ careerPath, checkpointDirectory });
    service.createCheckpoint(false);
    let db = openDatabase(careerPath);
    const snapshot = archiveSnapshot(db, {
      careerId: 1,
      directory: snapshotDirectory,
      reason: 'pre_match',
      payload: 'evidence',
      takenAt: 11,
      protocol: 1,
      inGameDate: 19999,
    });
    db.close();
    expect(service.state(false).snapshotState).toBe('stale');
    fs.appendFileSync(snapshot.record.raw_path, 'tamper');
    expect(service.state(false).snapshotState).toBe('corrupt');
    db = openDatabase(careerPath);
    expect(db.integrityProblem()).toBeNull();
    db.close();
  });
});
