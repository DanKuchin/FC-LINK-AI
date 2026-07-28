import type { Db } from '../../persistence/db.js';

export interface NormalizedPlayerMatchLine {
  readonly playerId: number;
  readonly appearances: 0 | 1;
  readonly goals: number;
  readonly assists: number;
  readonly yellow: number;
  readonly red: number;
  readonly cleanSheet: 0 | 1;
  readonly rating: number | null;
  readonly confidence?: number;
}

export interface ConfirmedResultInput {
  readonly fixtureId: number;
  readonly homeGoals: number;
  readonly awayGoals: number;
  readonly homePens?: number | null;
  readonly awayPens?: number | null;
  readonly playerLines: readonly NormalizedPlayerMatchLine[];
  readonly provenance: 'fc_sync' | 'user_entered';
  readonly snapshotBeforeId?: number | null;
  readonly snapshotAfterId?: number | null;
  readonly createdAt: number;
  /** A literal user action must set this. There is no auto-confirm path. */
  readonly confirmedByUser: boolean;
}

export interface CommittedResult {
  readonly matchResultId: number;
  readonly simEventId: number;
  readonly eventKey: string;
}

interface FixtureContext {
  readonly id: number;
  readonly career_id: number;
  readonly status: string;
  readonly current_date: number;
  readonly tick_index: number;
}

function integerInRange(name: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
}

function validate(input: ConfirmedResultInput): NormalizedPlayerMatchLine[] {
  if (!input.confirmedByUser) throw new Error('A result cannot commit before explicit user confirmation.');
  integerInRange('fixtureId', input.fixtureId, 1, Number.MAX_SAFE_INTEGER);
  integerInRange('homeGoals', input.homeGoals, 0, 99);
  integerInRange('awayGoals', input.awayGoals, 0, 99);

  const homePens = input.homePens ?? null;
  const awayPens = input.awayPens ?? null;
  if ((homePens === null) !== (awayPens === null)) {
    throw new Error('Penalty scores must provide both home and away values.');
  }
  if (homePens !== null && awayPens !== null) {
    integerInRange('homePens', homePens, 0, 99);
    integerInRange('awayPens', awayPens, 0, 99);
    if (input.homeGoals !== input.awayGoals) {
      throw new Error('A penalty shootout can only follow a drawn score.');
    }
    if (homePens === awayPens) throw new Error('A completed penalty shootout cannot be tied.');
  }

  const playerIds = new Set<number>();
  const lines = input.playerLines.slice().sort((left, right) => left.playerId - right.playerId);
  for (const line of lines) {
    integerInRange('playerId', line.playerId, 1, Number.MAX_SAFE_INTEGER);
    if (playerIds.has(line.playerId)) throw new Error(`Player ${line.playerId} appears twice.`);
    playerIds.add(line.playerId);
    integerInRange('appearances', line.appearances, 0, 1);
    integerInRange('goals', line.goals, 0, 99);
    integerInRange('assists', line.assists, 0, 99);
    integerInRange('yellow', line.yellow, 0, 2);
    integerInRange('red', line.red, 0, 1);
    integerInRange('cleanSheet', line.cleanSheet, 0, 1);
    if (line.rating !== null && (
      !Number.isFinite(line.rating) ||
      line.rating < 0 ||
      line.rating > 10
    )) {
      throw new Error('rating must be null or a number from 0 to 10');
    }
    if (line.confidence !== undefined && (
      !Number.isFinite(line.confidence) ||
      line.confidence < 0 ||
      line.confidence > 1
    )) {
      throw new Error('confidence must be from 0 to 1');
    }
  }
  if (input.provenance === 'fc_sync' && (
    input.snapshotBeforeId === undefined ||
    input.snapshotBeforeId === null ||
    input.snapshotAfterId === undefined ||
    input.snapshotAfterId === null
  )) {
    throw new Error('FC-synced results require both snapshot IDs.');
  }
  return lines;
}

function eventPayload(input: ConfirmedResultInput, lines: readonly NormalizedPlayerMatchLine[]): string {
  return JSON.stringify({
    home_goals: input.homeGoals,
    away_goals: input.awayGoals,
    home_pens: input.homePens ?? null,
    away_pens: input.awayPens ?? null,
    player_lines: lines.map((line) => ({
      player_id: line.playerId,
      appearances: line.appearances,
      goals: line.goals,
      assists: line.assists,
      yellow: line.yellow,
      red: line.red,
      clean_sheet: line.cleanSheet,
      rating: line.rating,
    })),
  });
}

/**
 * The one commit path shared by corrected sync results and manual fallback.
 * Provenance differs in the fact tables; the downstream simulation event does
 * not, so board/player consequences cannot depend on how the score arrived.
 */
export function commitConfirmedResult(db: Db, input: ConfirmedResultInput): CommittedResult {
  const lines = validate(input);
  return db.transaction(() => {
    const fixture = db.get<FixtureContext>(
      `SELECT
        f.id,
        f.career_id,
        f.status,
        careers.current_date AS current_date,
        careers.tick_index
       FROM fixtures f
       JOIN careers ON careers.id = f.career_id
       WHERE f.id = ?`,
      input.fixtureId,
    );
    if (fixture === undefined) throw new Error(`Fixture ${input.fixtureId} does not exist.`);
    if (fixture.status !== 'scheduled' && fixture.status !== 'user_pending') {
      throw new Error(`Fixture ${input.fixtureId} is already ${fixture.status}.`);
    }
    for (const line of lines) {
      const player = db.get<{ career_id: number }>(
        'SELECT career_id FROM players WHERE id = ?',
        line.playerId,
      );
      if (player === undefined || player.career_id !== fixture.career_id) {
        throw new Error(`Player ${line.playerId} does not belong to this career.`);
      }
    }

    const eventKey = `match-result:${fixture.id}`;
    const event = db.run(
      `INSERT INTO sim_events (
        career_id, event_key, tick, occurred_on, kind, subject_type, subject_id, payload_json
      ) VALUES (?, ?, ?, ?, 'match_result_confirmed', 'fixture', ?, ?)`,
      fixture.career_id,
      eventKey,
      fixture.tick_index,
      fixture.current_date,
      fixture.id,
      eventPayload(input, lines),
    );
    const result = db.run(
      `INSERT INTO match_results (
        fixture_id, home_goals, away_goals, home_pens, away_pens,
        provenance, confirmed_by_user, snapshot_before_id, snapshot_after_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      fixture.id,
      input.homeGoals,
      input.awayGoals,
      input.homePens ?? null,
      input.awayPens ?? null,
      input.provenance,
      input.snapshotBeforeId ?? null,
      input.snapshotAfterId ?? null,
      input.createdAt,
    );
    const matchResultId = Number(result.lastInsertRowid);
    for (const line of lines) {
      db.run(
        `INSERT INTO player_match_stats (
          match_result_id, player_id, appearances, goals, assists, yellow, red,
          clean_sheet, rating, derivation, confidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        matchResultId,
        line.playerId,
        line.appearances,
        line.goals,
        line.assists,
        line.yellow,
        line.red,
        line.cleanSheet,
        line.rating,
        input.provenance === 'user_entered' ? 'user_entered' : 'snapshot_diff',
        input.provenance === 'user_entered' ? 1 : (line.confidence ?? 1),
      );
    }
    db.run("UPDATE fixtures SET status = 'played' WHERE id = ?", fixture.id);
    return {
      matchResultId,
      simEventId: Number(event.lastInsertRowid),
      eventKey,
    };
  });
}
