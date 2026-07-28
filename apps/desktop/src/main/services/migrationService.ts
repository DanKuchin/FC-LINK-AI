import fs from 'node:fs';
import {
  createCheckpoint,
  type CheckpointInfo,
} from '@tenure/persistence/checkpoints.js';
import { openDatabase } from '@tenure/persistence/db.js';
import {
  MIGRATIONS_DIR,
  isUpToDate,
  migrate,
  type MigrationResult,
} from '@tenure/persistence/migrate.js';

export interface CareerMigrationResult {
  readonly migrated: boolean;
  readonly migration: MigrationResult | null;
  readonly checkpoint: CheckpointInfo | null;
}

/**
 * Upgrades an existing career before any desktop service reads it. A verified
 * pre-migration checkpoint is mandatory; if either backup or migration fails,
 * startup fails loudly and the original save remains recoverable.
 */
export function migrateActiveCareer(options: {
  readonly careerPath: string;
  readonly checkpointDirectory: string;
  readonly migrationDirectory?: string;
  readonly now?: number;
}): CareerMigrationResult {
  if (!fs.existsSync(options.careerPath)) {
    return { migrated: false, migration: null, checkpoint: null };
  }
  const db = openDatabase(options.careerPath);
  try {
    const migrationDirectory = options.migrationDirectory ?? MIGRATIONS_DIR;
    if (isUpToDate(db, migrationDirectory)) {
      return { migrated: false, migration: null, checkpoint: null };
    }
    const career = db.get<{ id: number; current_date: number }>(
      'SELECT id, careers.current_date AS current_date FROM careers ORDER BY id LIMIT 1',
    );
    const now = options.now ?? Date.now();
    const checkpoint = createCheckpoint(db, {
      dir: options.checkpointDirectory,
      reason: 'pre_migration',
      label: 'Automatic checkpoint before save-schema migration',
      careerId: career?.id ?? null,
      inGameDate: career?.current_date ?? null,
      now,
    });
    const migration = migrate(db, { now, dir: migrationDirectory });
    return { migrated: true, migration, checkpoint };
  } finally {
    db.close();
  }
}
