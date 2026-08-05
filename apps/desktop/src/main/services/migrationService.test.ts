import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listCheckpoints,
  verifyCheckpoint,
} from '../../../../../packages/persistence/checkpoints.js';
import { openDatabase } from '../../../../../packages/persistence/db.js';
import {
  migrate,
  schemaVersion,
} from '../../../../../packages/persistence/migrate.js';
import { migrateActiveCareer } from './migrationService.js';

let temporaryDirectory: string;
let careerPath: string;
let checkpointDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenure-migration-service-'));
  careerPath = path.join(temporaryDirectory, 'career.db');
  checkpointDirectory = path.join(temporaryDirectory, 'checkpoints');
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('desktop career migration service', () => {
  it('opens a v1 career at v4 only after a verified pre-migration checkpoint', () => {
    let db = openDatabase(careerPath);
    migrate(db, { now: 1, targetVersion: 1 });
    db.run(
      `INSERT INTO careers (
        id, name, save_uid, master_seed, current_date, schema_version, created_at, updated_at
      ) VALUES (1, 'Old desktop save', 'old-desktop', 'seed', 20000, 1, 1, 1)`,
    );
    db.close();

    const result = migrateActiveCareer({
      careerPath,
      checkpointDirectory,
      now: 50,
    });
    expect(result.migration).toMatchObject({ from: 1, to: 4, applied: [2, 3, 4] });
    expect(result.checkpoint?.reason).toBe('pre_migration');
    expect(result.checkpoint === null ? null : verifyCheckpoint(result.checkpoint).ok).toBe(true);

    db = openDatabase(careerPath);
    expect(schemaVersion(db)).toBe(4);
    expect(db.get<{ name: string }>('SELECT name FROM careers')?.name).toBe('Old desktop save');
    db.close();
    expect(listCheckpoints(checkpointDirectory)).toHaveLength(1);
  });
});
