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
  PostMatchCheckpointIssue,
  PostMatchCheckpointRetry,
} from '../../shared/ipc.js';

export interface ResultServiceOptions {
  readonly careerPath: string;
  readonly checkpointDirectory: string;
  readonly now?: () => number;
  readonly createCheckpoint?: typeof createCheckpoint;
}

interface ResultCheckpointContext {
  readonly match_result_id: number;
  readonly fixture_id: number;
  readonly career_id: number;
  readonly current_date: number;
  readonly in_game_date: number;
  readonly state: 'pending' | 'created' | 'failed' | 'legacy';
  readonly checkpoint_id: string | null;
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

  listPostMatchCheckpointIssues(): readonly PostMatchCheckpointIssue[] {
    if (!fs.existsSync(this.options.careerPath)) return [];
    const db = openDatabase(this.options.careerPath);
    try {
      return db.all<{
        match_result_id: number;
        fixture_id: number;
        state: 'pending' | 'failed';
        last_error: string | null;
      }>(
        `SELECT
          match_result_checkpoints.match_result_id,
          match_results.fixture_id,
          match_result_checkpoints.state,
          match_result_checkpoints.last_error
         FROM match_result_checkpoints
         JOIN match_results
           ON match_results.id = match_result_checkpoints.match_result_id
         WHERE match_result_checkpoints.state IN ('pending', 'failed')
         ORDER BY match_result_checkpoints.updated_at, match_result_checkpoints.match_result_id`,
      ).map((issue) => ({
        matchResultId: issue.match_result_id,
        fixtureId: issue.fixture_id,
        state: issue.state,
        lastError: issue.last_error,
      }));
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
        checkpoint.inGameDate === fixture.current_date &&
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
      try {
        const checkpointId = this.createOrAdoptCheckpoint(
          db,
          committed.matchResultId,
          draft.fixtureId,
          fixture.career_id,
          fixture.current_date,
          now,
        );
        return {
          matchResultId: committed.matchResultId,
          simEventId: committed.simEventId,
          checkpointId,
          checkpointState: 'created',
          warning: null,
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        try {
          db.run(
            `UPDATE match_result_checkpoints
             SET state = 'failed', checkpoint_id = NULL, last_error = ?, updated_at = ?
             WHERE match_result_id = ?`,
            detail.slice(0, 1_000),
            now,
            committed.matchResultId,
          );
        } catch {
          // The score is already durable. Never misreport it as uncommitted merely
          // because even the recovery-ledger update hit the same storage failure.
        }
        return {
          matchResultId: committed.matchResultId,
          simEventId: committed.simEventId,
          checkpointId: null,
          checkpointState: 'failed',
          warning:
            `Result ${committed.matchResultId} was committed, but its post-match ` +
            `checkpoint failed: ${detail}`,
        };
      }
    } finally {
      db.close();
    }
  }

  retryPostMatchCheckpoint(matchResultId: number): PostMatchCheckpointRetry {
    if (!fs.existsSync(this.options.careerPath)) {
      throw new Error('No active career database exists.');
    }
    const db = openDatabase(this.options.careerPath);
    let markFailure = false;
    try {
      const context = db.get<ResultCheckpointContext>(
        `SELECT
          match_result_checkpoints.match_result_id,
          match_results.fixture_id,
          fixtures.career_id,
          careers.current_date,
          match_result_checkpoints.in_game_date,
          match_result_checkpoints.state,
          match_result_checkpoints.checkpoint_id
         FROM match_result_checkpoints
         JOIN match_results
           ON match_results.id = match_result_checkpoints.match_result_id
         JOIN fixtures ON fixtures.id = match_results.fixture_id
         JOIN careers ON careers.id = fixtures.career_id
         WHERE match_result_checkpoints.match_result_id = ?`,
        matchResultId,
      );
      if (context === undefined) {
        throw new Error(`Match result ${matchResultId} has no checkpoint recovery record.`);
      }
      if (context.state === 'legacy') {
        throw new Error(
          `Match result ${matchResultId} predates durable checkpoint tracking. ` +
          'Use an existing verified checkpoint; its historical state cannot be reconstructed.',
        );
      }
      markFailure = true;

      if (context.checkpoint_id !== null) {
        const existing = listCheckpoints(this.options.checkpointDirectory)
          .find((checkpoint) => checkpoint.id === context.checkpoint_id);
        if (existing !== undefined && verifyCheckpoint(existing).ok) {
          return { matchResultId, checkpointId: existing.id };
        }
      }
      if (context.current_date !== context.in_game_date) {
        throw new Error(
          'The career has advanced since this result. Restore its pre-match checkpoint ' +
          'instead of creating a checkpoint for the wrong in-game day.',
        );
      }

      const now = this.options.now?.() ?? Date.now();
      const checkpointId = this.createOrAdoptCheckpoint(
        db,
        matchResultId,
        context.fixture_id,
        context.career_id,
        context.in_game_date,
        now,
      );
      return { matchResultId, checkpointId };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (markFailure) {
        try {
          db.run(
            `UPDATE match_result_checkpoints
             SET state = 'failed', checkpoint_id = NULL, last_error = ?, updated_at = ?
             WHERE match_result_id = ?`,
            detail.slice(0, 1_000),
            this.options.now?.() ?? Date.now(),
            matchResultId,
          );
        } catch {
          // Preserve the actionable retry error if the ledger cannot also update.
        }
      }
      throw error;
    } finally {
      db.close();
    }
  }

  private createOrAdoptCheckpoint(
    db: ReturnType<typeof openDatabase>,
    matchResultId: number,
    fixtureId: number,
    careerId: number,
    inGameDate: number,
    now: number,
  ): string {
    const label = `Confirmed manual result for fixture ${fixtureId}`;
    const existing = listCheckpoints(this.options.checkpointDirectory).find((checkpoint) =>
      checkpoint.reason === 'post_match' &&
      checkpoint.label === label &&
      checkpoint.careerId === careerId &&
      checkpoint.inGameDate === inGameDate &&
      verifyCheckpoint(checkpoint).ok);
    const checkpoint = existing ?? (this.options.createCheckpoint ?? createCheckpoint)(db, {
      dir: this.options.checkpointDirectory,
      reason: 'post_match',
      label,
      careerId,
      inGameDate,
      now,
    });
    db.run(
      `UPDATE match_result_checkpoints
       SET state = 'created', checkpoint_id = ?, last_error = NULL, updated_at = ?
       WHERE match_result_id = ?`,
      checkpoint.id,
      now,
      matchResultId,
    );
    return checkpoint.id;
  }
}
