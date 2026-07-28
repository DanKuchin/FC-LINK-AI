import fs from 'node:fs';
import {
  createCheckpoint,
  listCheckpoints,
  verifyCheckpoint,
} from '@tenure/persistence/checkpoints.js';
import { openDatabase } from '@tenure/persistence/db.js';
import { commitConfirmedResult } from '@tenure/sync/match/confirmedResult.js';
import type {
  FixturePlayer,
  ManualResultCommit,
  ManualResultDraft,
  PendingFixture,
} from '../../shared/ipc.js';

export interface ResultServiceOptions {
  readonly careerPath: string;
  readonly checkpointDirectory: string;
  readonly now?: () => number;
}

export class ResultService {
  private readonly options: ResultServiceOptions;

  constructor(options: ResultServiceOptions) {
    this.options = options;
  }

  listPendingFixtures(): readonly PendingFixture[] {
    if (!fs.existsSync(this.options.careerPath)) return [];
    const db = openDatabase(this.options.careerPath);
    try {
      return db.all<{
        id: number;
        scheduled_date: number;
        home_club: string;
        away_club: string;
      }>(
        `SELECT
          fixtures.id,
          fixtures.scheduled_date,
          home.name AS home_club,
          away.name AS away_club
         FROM fixtures
         JOIN clubs home ON home.id = fixtures.home_club_id
         JOIN clubs away ON away.id = fixtures.away_club_id
         WHERE fixtures.status IN ('scheduled', 'user_pending')
         ORDER BY fixtures.scheduled_date, fixtures.id`,
      ).map((fixture) => ({
        id: fixture.id,
        scheduledDate: fixture.scheduled_date,
        homeClub: fixture.home_club,
        awayClub: fixture.away_club,
      }));
    } finally {
      db.close();
    }
  }

  listFixturePlayers(fixtureId: number): readonly FixturePlayer[] {
    if (!fs.existsSync(this.options.careerPath)) return [];
    const db = openDatabase(this.options.careerPath);
    try {
      return db.all<{
        id: number;
        name: string;
        side: 'home' | 'away';
      }>(
        `SELECT
          players.id,
          TRIM(COALESCE(players.first_name, '') || ' ' ||
               COALESCE(players.last_name, players.known_as, '')) AS name,
          CASE players.club_id
            WHEN fixtures.home_club_id THEN 'home'
            ELSE 'away'
          END AS side
         FROM fixtures
         JOIN players
           ON players.club_id IN (fixtures.home_club_id, fixtures.away_club_id)
          AND players.deleted_at IS NULL
         WHERE fixtures.id = ?
         ORDER BY side, players.last_name, players.first_name, players.id`,
        fixtureId,
      );
    } finally {
      db.close();
    }
  }

  commitManual(draft: ManualResultDraft): ManualResultCommit {
    if (!fs.existsSync(this.options.careerPath)) {
      throw new Error('No active career database exists.');
    }
    const db = openDatabase(this.options.careerPath);
    try {
      const fixture = db.get<{ career_id: number; current_date: number }>(
        `SELECT
          fixtures.career_id,
          careers.current_date AS current_date
         FROM fixtures
         JOIN careers ON careers.id = fixtures.career_id
         WHERE fixtures.id = ?`,
        draft.fixtureId,
      );
      if (fixture === undefined) throw new Error(`Fixture ${draft.fixtureId} does not exist.`);
      const now = this.options.now?.() ?? Date.now();
      const preMatch = listCheckpoints(this.options.checkpointDirectory).find((checkpoint) =>
        checkpoint.reason === 'pre_match' &&
        checkpoint.careerId === fixture.career_id &&
        verifyCheckpoint(checkpoint).ok);
      if (preMatch === undefined) {
        throw new Error(
          'A verified pre-match checkpoint is required before confirming any result.',
        );
      }
      const committed = commitConfirmedResult(db, {
        ...draft,
        provenance: 'user_entered',
        createdAt: now,
        confirmedByUser: true,
      });
      const checkpoint = createCheckpoint(db, {
        dir: this.options.checkpointDirectory,
        reason: 'post_match',
        label: `Confirmed manual result for fixture ${draft.fixtureId}`,
        careerId: fixture.career_id,
        inGameDate: fixture.current_date,
        now,
      });
      return {
        matchResultId: committed.matchResultId,
        simEventId: committed.simEventId,
        checkpointId: checkpoint.id,
      };
    } finally {
      db.close();
    }
  }
}
