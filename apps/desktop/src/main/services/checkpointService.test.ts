import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCheckpoint } from '../../../../../packages/persistence/checkpoints.js';
import { openDatabase } from '../../../../../packages/persistence/db.js';
import { migrate } from '../../../../../packages/persistence/migrate.js';
import { CheckpointService } from './checkpointService.js';

let temporaryDirectory: string;
let careerPath: string;
let checkpointDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenure-checkpoint-service-'));
  careerPath = path.join(temporaryDirectory, 'career.db');
  checkpointDirectory = path.join(temporaryDirectory, 'checkpoints');
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function seedCareer(): ReturnType<typeof openDatabase> {
  const db = openDatabase(careerPath);
  migrate(db, { now: 1 });
  db.run(
    `INSERT INTO careers (
      id, name, save_uid, master_seed, current_date, schema_version, created_at, updated_at
    ) VALUES (1, 'Before', 'restore-service', 'seed', 20000, 3, 1, 1)`,
  );
  return db;
}

describe('desktop checkpoint service', () => {
  it('lists verification state and restores only a known checkpoint ID', () => {
    let db = seedCareer();
    const checkpoint = createCheckpoint(db, {
      dir: checkpointDirectory,
      reason: 'manual',
      label: 'Before the test',
      careerId: 1,
      now: 10,
    });
    db.run("UPDATE careers SET name = 'After' WHERE id = 1");
    db.close();

    const service = new CheckpointService({
      checkpointDirectory,
      activeCareerPath: careerPath,
      now: () => 20,
    });
    expect(service.list()).toEqual([{
      id: checkpoint.id,
      label: 'Before the test',
      createdAt: 10,
      verified: true,
    }]);
    expect(() => service.restore('../unknown')).toThrow(/Checkpoint not found/);

    const restored = service.restore(checkpoint.id);
    expect(restored).toMatchObject({ restored: true, checkpointId: checkpoint.id });
    expect(fs.existsSync(restored.safetyCopyPath)).toBe(true);
    db = openDatabase(careerPath);
    expect(db.get<{ name: string }>('SELECT name FROM careers WHERE id = 1')?.name).toBe('Before');
    expect(db.all('SELECT * FROM restore_history')).toHaveLength(1);
    db.close();
  });

  it('refuses restore when there is no active career target', () => {
    const service = new CheckpointService({
      checkpointDirectory,
      activeCareerPath: careerPath,
    });
    expect(() => service.restore('anything')).toThrow(/No active career/);
  });

  it('shows a tampered checkpoint as unverified and refuses to restore it', () => {
    const db = seedCareer();
    const checkpoint = createCheckpoint(db, {
      dir: checkpointDirectory,
      reason: 'manual',
      now: 10,
    });
    db.close();
    fs.appendFileSync(checkpoint.dbPath, 'tampered');
    const service = new CheckpointService({
      checkpointDirectory,
      activeCareerPath: careerPath,
    });
    expect(service.list()[0]?.verified).toBe(false);
    expect(() => service.restore(checkpoint.id)).toThrow(/Refusing to restore/);
  });
});
