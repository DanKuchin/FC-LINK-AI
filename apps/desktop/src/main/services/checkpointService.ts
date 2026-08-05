import fs from 'node:fs';
import {
  listCheckpoints,
  restoreCheckpoint,
  verifyCheckpoint,
} from '@tenure/persistence/checkpoints.js';
import { openDatabase } from '@tenure/persistence/db.js';
import { recordRestoreHistory } from '@tenure/persistence/diagnostics.js';
import type { CheckpointSummary, RestoreCheckpointResult } from '../../shared/ipc.js';

export interface CheckpointServiceOptions {
  readonly checkpointDirectory: string;
  readonly activeCareerPath: string;
  readonly now?: () => number;
}

export class CheckpointService {
  private readonly options: CheckpointServiceOptions;

  constructor(options: CheckpointServiceOptions) {
    this.options = options;
  }

  list(): readonly CheckpointSummary[] {
    return listCheckpoints(this.options.checkpointDirectory).map((checkpoint) => ({
      id: checkpoint.id,
      label: checkpoint.label,
      createdAt: checkpoint.createdAt,
      verified: verifyCheckpoint(checkpoint).ok,
    }));
  }

  restore(
    checkpointId: string,
  ): Extract<RestoreCheckpointResult, { readonly restored: true }> {
    if (!fs.existsSync(this.options.activeCareerPath)) {
      throw new Error('No active career database exists to restore.');
    }
    const checkpoint = listCheckpoints(this.options.checkpointDirectory)
      .find((candidate) => candidate.id === checkpointId);
    if (checkpoint === undefined) throw new Error(`Checkpoint not found: ${checkpointId}`);

    const now = this.options.now?.() ?? Date.now();
    const result = restoreCheckpoint(checkpoint, this.options.activeCareerPath, { now });
    const restoredDb = openDatabase(this.options.activeCareerPath);
    try {
      recordRestoreHistory(restoredDb, {
        careerId: checkpoint.careerId,
        checkpointManifest: checkpoint.manifestPath,
        restoredAt: now,
        safetyCopyPath: result.safetyCopy,
        result: 'restored',
      });
    } finally {
      restoredDb.close();
    }
    return {
      restored: true,
      checkpointId: checkpoint.id,
      safetyCopyPath: result.safetyCopy,
    };
  }
}
