import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../../../../packages/persistence/db.js';
import { migrate } from '../../../../../packages/persistence/migrate.js';
import {
  createCheckpoint,
  listCheckpoints,
} from '../../../../../packages/persistence/checkpoints.js';
import { ResultService } from './resultService.js';

let temporaryDirectory: string;
let careerPath: string;
let checkpointDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenure-result-service-'));
  careerPath = path.join(temporaryDirectory, 'career.db');
  checkpointDirectory = path.join(temporaryDirectory, 'checkpoints');
  const db = openDatabase(careerPath);
  migrate(db, { now: 1 });
  db.run(
    `INSERT INTO careers (
      id, name, save_uid, master_seed, current_date, schema_version, created_at, updated_at
    ) VALUES (1, 'Result UI', 'result-ui', 'seed', 20000, 3, 1, 1)`,
  );
  db.run("INSERT INTO seasons VALUES (1, 1, 2026, 2027, 'active')");
  db.run("INSERT INTO competitions (id, career_id, name, kind) VALUES (1, 1, 'League', 'league')");
  db.run(
    `INSERT INTO clubs (id, career_id, name, created_at, updated_at)
     VALUES (1, 1, 'Home', 1, 1), (2, 1, 'Away', 1, 1)`,
  );
  db.run(
    `INSERT INTO players (
      id, career_id, club_id, first_name, last_name, birth_date,
      primary_position, created_at, updated_at
    ) VALUES
      (1, 1, 1, 'Alex', 'Home', 10000, 'ST', 1, 1),
      (2, 1, 2, 'Sam', 'Away', 10000, 'GK', 1, 1)`,
  );
  db.run(
    `INSERT INTO fixtures (
      id, career_id, season_id, competition_id, home_club_id, away_club_id,
      scheduled_date, status
    ) VALUES (1, 1, 1, 1, 1, 2, 20000, 'scheduled')`,
  );
  db.close();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('desktop result service', () => {
  it('lists the pending fixture and both squads without exposing database access', () => {
    const service = new ResultService({ careerPath, checkpointDirectory });
    expect(service.listPendingFixtures()).toEqual([{
      id: 1,
      scheduledDate: 20000,
      homeClub: 'Home',
      awayClub: 'Away',
    }]);
    expect(service.listFixturePlayers(1)).toEqual([
      { id: 2, name: 'Sam Away', side: 'away' },
      { id: 1, name: 'Alex Home', side: 'home' },
    ]);
  });

  it('requires a pre-match recovery point and checkpoints the confirmed result', () => {
    const service = new ResultService({
      careerPath,
      checkpointDirectory,
      now: () => 50,
    });
    let db = openDatabase(careerPath);
    createCheckpoint(db, {
      dir: checkpointDirectory,
      reason: 'pre_match',
      careerId: 1,
      inGameDate: 20000,
      now: 40,
    });
    db.close();
    const result = service.commitManual({
      fixtureId: 1,
      homeGoals: 1,
      awayGoals: 0,
      playerLines: [{
        playerId: 1,
        appearances: 1,
        goals: 1,
        assists: 0,
        yellow: 0,
        red: 0,
        cleanSheet: 0,
        rating: 8,
      }],
    });
    expect(result.checkpointId).toContain('post_match');
    expect(result.checkpointState).toBe('created');
    expect(result.warning).toBeNull();
    expect(listCheckpoints(checkpointDirectory)).toHaveLength(2);
    db = openDatabase(careerPath);
    expect(db.get<{ provenance: string }>('SELECT provenance FROM match_results')?.provenance)
      .toBe('user_entered');
    expect(db.get<{ state: string; checkpoint_id: string }>(
      'SELECT state, checkpoint_id FROM match_result_checkpoints',
    )).toEqual({ state: 'created', checkpoint_id: result.checkpointId });
    db.close();
  });

  it('keeps a committed result distinct from a failed checkpoint and retries safely', () => {
    let db = openDatabase(careerPath);
    createCheckpoint(db, {
      dir: checkpointDirectory,
      reason: 'pre_match',
      careerId: 1,
      inGameDate: 20000,
      now: 40,
    });
    db.close();
    const failing = new ResultService({
      careerPath,
      checkpointDirectory,
      now: () => 50,
      createCheckpoint: () => {
        throw new Error('disk full');
      },
    });
    const committed = failing.commitManual({
      fixtureId: 1,
      homeGoals: 1,
      awayGoals: 0,
      playerLines: [],
    });
    expect(committed).toMatchObject({
      matchResultId: 1,
      checkpointId: null,
      checkpointState: 'failed',
    });
    expect(committed.warning).toMatch(/was committed.*disk full/);
    expect(new ResultService({ careerPath, checkpointDirectory })
      .listPostMatchCheckpointIssues()).toEqual([{
      matchResultId: 1,
      fixtureId: 1,
      state: 'failed',
      lastError: 'disk full',
    }]);

    db = openDatabase(careerPath);
    expect(db.all('SELECT * FROM match_results')).toHaveLength(1);
    expect(db.get<{ state: string; last_error: string }>(
      'SELECT state, last_error FROM match_result_checkpoints',
    )).toEqual({ state: 'failed', last_error: 'disk full' });
    db.close();

    const recovered = new ResultService({
      careerPath,
      checkpointDirectory,
      now: () => 60,
    }).retryPostMatchCheckpoint(committed.matchResultId);
    expect(recovered.matchResultId).toBe(committed.matchResultId);
    expect(recovered.checkpointId).toContain('post_match');
    expect(listCheckpoints(checkpointDirectory)).toHaveLength(2);
    expect(new ResultService({ careerPath, checkpointDirectory })
      .listPostMatchCheckpointIssues()).toEqual([]);

    db = openDatabase(careerPath);
    expect(db.get<{ state: string; checkpoint_id: string; last_error: null }>(
      'SELECT state, checkpoint_id, last_error FROM match_result_checkpoints',
    )).toEqual({
      state: 'created',
      checkpoint_id: recovered.checkpointId,
      last_error: null,
    });
    db.close();
  });

  it('refuses to commit when the pre-match checkpoint is missing', () => {
    const service = new ResultService({ careerPath, checkpointDirectory });
    expect(() => service.commitManual({
      fixtureId: 1,
      homeGoals: 1,
      awayGoals: 0,
      playerLines: [],
    })).toThrow(/pre-match checkpoint/);
    const db = openDatabase(careerPath);
    expect(db.all('SELECT * FROM match_results')).toHaveLength(0);
    db.close();
  });

  it('refuses a verified pre-match checkpoint from an earlier career day', () => {
    const db = openDatabase(careerPath);
    createCheckpoint(db, {
      dir: checkpointDirectory,
      reason: 'pre_match',
      careerId: 1,
      inGameDate: 19999,
      now: 40,
    });
    db.close();
    const service = new ResultService({ careerPath, checkpointDirectory });
    expect(() => service.commitManual({
      fixtureId: 1,
      homeGoals: 0,
      awayGoals: 0,
      playerLines: [],
    })).toThrow(/pre-match checkpoint/);
  });
});
