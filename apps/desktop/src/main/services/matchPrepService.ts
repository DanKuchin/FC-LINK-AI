import fs from 'node:fs';
import {
  createCheckpoint,
  listCheckpoints,
  verifyCheckpoint,
} from '@tenure/persistence/checkpoints.js';
import { openDatabase } from '@tenure/persistence/db.js';
import {
  verifyArchivedSnapshot,
  type SnapshotRecord,
} from '@tenure/persistence/snapshots.js';
import {
  evaluateLaunchGate,
  type PreMatchSnapshotState,
} from '@tenure/sync/match/launchGate.js';
import type { MatchPrepState } from '../../shared/ipc.js';

export interface MatchPrepServiceOptions {
  readonly careerPath: string;
  readonly checkpointDirectory: string;
  readonly now?: () => number;
}

interface CareerContext {
  readonly id: number;
  readonly current_date: number;
}

export class MatchPrepService {
  private readonly options: MatchPrepServiceOptions;

  constructor(options: MatchPrepServiceOptions) {
    this.options = options;
  }

  state(manualResultModeConfirmed: boolean): MatchPrepState {
    if (!fs.existsSync(this.options.careerPath)) {
      return this.decision(false, 'missing', manualResultModeConfirmed);
    }
    const db = openDatabase(this.options.careerPath);
    try {
      const career = db.get<CareerContext>(
        'SELECT id, careers.current_date AS current_date FROM careers ORDER BY id LIMIT 1',
      );
      if (career === undefined) return this.decision(false, 'missing', manualResultModeConfirmed);
      const checkpointVerified = listCheckpoints(this.options.checkpointDirectory).some(
        (checkpoint) =>
          checkpoint.reason === 'pre_match' &&
          checkpoint.careerId === career.id &&
          checkpoint.inGameDate === career.current_date &&
          verifyCheckpoint(checkpoint).ok,
      );
      const snapshot = db.get<SnapshotRecord>(
        `SELECT * FROM sync_snapshots
         WHERE career_id = ? AND reason = 'pre_match'
         ORDER BY taken_at DESC, id DESC
         LIMIT 1`,
        career.id,
      );
      let snapshotState: PreMatchSnapshotState = 'missing';
      if (snapshot !== undefined) {
        const problem = verifyArchivedSnapshot(snapshot);
        if (problem !== null) snapshotState = 'corrupt';
        else if (snapshot.in_game_date !== career.current_date) snapshotState = 'stale';
        else snapshotState = 'ready';
      }
      return this.decision(checkpointVerified, snapshotState, manualResultModeConfirmed);
    } finally {
      db.close();
    }
  }

  createCheckpoint(manualResultModeConfirmed: boolean): MatchPrepState {
    if (!fs.existsSync(this.options.careerPath)) {
      throw new Error('No active career database exists.');
    }
    const db = openDatabase(this.options.careerPath);
    try {
      const career = db.get<CareerContext>(
        'SELECT id, careers.current_date AS current_date FROM careers ORDER BY id LIMIT 1',
      );
      if (career === undefined) throw new Error('The active database contains no career.');
      createCheckpoint(db, {
        dir: this.options.checkpointDirectory,
        reason: 'pre_match',
        label: `Before match on career day ${career.current_date}`,
        careerId: career.id,
        inGameDate: career.current_date,
        now: this.options.now?.() ?? Date.now(),
      });
    } finally {
      db.close();
    }
    return this.state(manualResultModeConfirmed);
  }

  private decision(
    checkpointVerified: boolean,
    snapshotState: PreMatchSnapshotState,
    manualResultModeConfirmed: boolean,
  ): MatchPrepState {
    return {
      checkpointVerified,
      snapshotState,
      decision: evaluateLaunchGate({
        checkpointVerified,
        snapshotState,
        manualResultModeConfirmed,
      }),
    };
  }
}
