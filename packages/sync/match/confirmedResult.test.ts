import { describe, expect, it } from 'vitest';
import { openMemoryDatabase, type Db } from '../../persistence/db.js';
import { migrate } from '../../persistence/migrate.js';
import {
  commitConfirmedResult,
  type ConfirmedResultInput,
} from './confirmedResult.js';

function seededDb(): Db {
  const db = openMemoryDatabase();
  migrate(db, { now: 1 });
  db.run(
    `INSERT INTO careers (
      id, name, save_uid, master_seed, current_date, tick_index,
      schema_version, created_at, updated_at
    ) VALUES (1, 'Result test', 'result-save', 'seed', 20000, 7, 3, 1, 1)`,
  );
  db.run(
    `INSERT INTO seasons (id, career_id, start_year, end_year, status)
     VALUES (1, 1, 2026, 2027, 'active')`,
  );
  db.run(
    `INSERT INTO competitions (id, career_id, name, kind)
     VALUES (1, 1, 'Test League', 'league')`,
  );
  db.run(
    `INSERT INTO clubs (id, career_id, name, created_at, updated_at)
     VALUES (1, 1, 'Home', 1, 1), (2, 1, 'Away', 1, 1)`,
  );
  db.run(
    `INSERT INTO players (
      id, career_id, club_id, first_name, birth_date, primary_position, created_at, updated_at
    ) VALUES
      (1, 1, 1, 'One', 10000, 'ST', 1, 1),
      (2, 1, 1, 'Two', 10000, 'GK', 1, 1)`,
  );
  db.run(
    `INSERT INTO fixtures (
      id, career_id, season_id, competition_id, home_club_id, away_club_id,
      scheduled_date, status
    ) VALUES (1, 1, 1, 1, 1, 2, 20000, 'scheduled')`,
  );
  return db;
}

const manual: ConfirmedResultInput = {
  fixtureId: 1,
  homeGoals: 2,
  awayGoals: 1,
  playerLines: [
    {
      playerId: 1,
      appearances: 1,
      goals: 2,
      assists: 0,
      yellow: 0,
      red: 0,
      cleanSheet: 0,
      rating: 8.4,
    },
    {
      playerId: 2,
      appearances: 1,
      goals: 0,
      assists: 0,
      yellow: 0,
      red: 0,
      cleanSheet: 0,
      rating: 6.9,
    },
  ],
  provenance: 'user_entered',
  createdAt: 100,
  confirmedByUser: true,
};

describe('confirmed match result', () => {
  it('commits a full manual result, lines, provenance and causal event atomically', () => {
    const db = seededDb();
    const committed = commitConfirmedResult(db, manual);
    expect(committed.eventKey).toBe('match-result:1');
    expect(db.get<{
      provenance: string;
      confirmed_by_user: number;
    }>('SELECT provenance, confirmed_by_user FROM match_results')).toEqual({
      provenance: 'user_entered',
      confirmed_by_user: 1,
    });
    expect(db.all<{ derivation: string }>(
      'SELECT derivation FROM player_match_stats ORDER BY player_id',
    )).toEqual([{ derivation: 'user_entered' }, { derivation: 'user_entered' }]);
    expect(db.get<{ status: string }>('SELECT status FROM fixtures WHERE id = 1')?.status)
      .toBe('played');
    expect(db.get<{ kind: string }>('SELECT kind FROM sim_events')?.kind)
      .toBe('match_result_confirmed');
    expect(db.get<{
      in_game_date: number;
      state: string;
    }>('SELECT in_game_date, state FROM match_result_checkpoints')).toEqual({
      in_game_date: 20000,
      state: 'pending',
    });
    db.close();
  });

  it('has no auto-confirm path', () => {
    const db = seededDb();
    expect(() => commitConfirmedResult(db, { ...manual, confirmedByUser: false }))
      .toThrow(/explicit user confirmation/);
    expect(db.all('SELECT * FROM match_results')).toHaveLength(0);
    expect(db.all('SELECT * FROM sim_events')).toHaveLength(0);
    db.close();
  });

  it('rolls back the event and result when a player is outside the career', () => {
    const db = seededDb();
    expect(() => commitConfirmedResult(db, {
      ...manual,
      playerLines: [{ ...manual.playerLines[0]!, playerId: 999 }],
    })).toThrow(/does not belong/);
    expect(db.all('SELECT * FROM match_results')).toHaveLength(0);
    expect(db.all('SELECT * FROM sim_events')).toHaveLength(0);
    expect(db.get<{ status: string }>('SELECT status FROM fixtures WHERE id = 1')?.status)
      .toBe('scheduled');
    db.close();
  });

  it('rejects duplicate players and impossible penalty scores before mutation', () => {
    const db = seededDb();
    expect(() => commitConfirmedResult(db, {
      ...manual,
      playerLines: [manual.playerLines[0]!, manual.playerLines[0]!],
    })).toThrow(/appears twice/);
    expect(() => commitConfirmedResult(db, {
      ...manual,
      homePens: 5,
      awayPens: 4,
    })).toThrow(/drawn score/);
    expect(db.all('SELECT * FROM sim_events')).toHaveLength(0);
    db.close();
  });

  it('emits identical downstream facts for synced and manually entered results', () => {
    const manualDb = seededDb();
    commitConfirmedResult(manualDb, manual);
    const manualEvent = manualDb.get<{ payload_json: string }>(
      'SELECT payload_json FROM sim_events',
    )?.payload_json;

    const syncedDb = seededDb();
    syncedDb.run(
      `INSERT INTO sync_snapshots (
        id, career_id, taken_at, reason, protocol, checksum, raw_path
      ) VALUES
        (1, 1, 1, 'pre_match', 1, 'a', 'before'),
        (2, 1, 2, 'post_match', 1, 'b', 'after')`,
    );
    commitConfirmedResult(syncedDb, {
      ...manual,
      provenance: 'fc_sync',
      snapshotBeforeId: 1,
      snapshotAfterId: 2,
    });
    const syncedEvent = syncedDb.get<{ payload_json: string }>(
      'SELECT payload_json FROM sim_events',
    )?.payload_json;
    expect(syncedEvent).toBe(manualEvent);
    manualDb.close();
    syncedDb.close();
  });
});
