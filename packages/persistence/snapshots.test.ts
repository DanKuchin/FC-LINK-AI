import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from './db.js';
import { migrate } from './migrate.js';
import {
  archiveSnapshot,
  loadArchivedSnapshot,
  verifyArchivedSnapshot,
} from './snapshots.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenure-snapshot-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createCareerDatabase(directory: string) {
  const db = openDatabase(path.join(directory, 'career.sqlite'));
  migrate(db, { now: 1 });
  db.run(
    `INSERT INTO careers (
      id, name, save_uid, master_seed, current_date, tick_index,
      schema_version, sync_mode, created_at, updated_at
    ) VALUES (1, 'Test', 'save-1', 'seed', 20000, 0, 1, 'connected', 1, 1)`,
  );
  return db;
}

describe('raw snapshot archive', () => {
  it('stores opaque bytes atomically with metadata and verifies round-trip integrity', () => {
    const directory = temporaryDirectory();
    const db = createCareerDatabase(directory);
    try {
      const payload = Buffer.from('{"opaque":"café ⚽"}\n');
      const archived = archiveSnapshot(db, {
        careerId: 1,
        directory: path.join(directory, 'snapshots'),
        reason: 'career_loaded',
        payload,
        takenAt: 1234,
        protocol: 1,
        gameBuild: 'mock-build',
        liveEditorVersion: 'mock-le',
        inGameDate: 20000,
        entityCounts: { players: 25, clubs: 1 },
      });

      expect(archived.bytes).toBe(payload.length);
      expect(archived.record).toMatchObject({
        career_id: 1,
        reason: 'career_loaded',
        game_build: 'mock-build',
        le_version: 'mock-le',
        protocol: 1,
        in_game_date: 20000,
      });
      expect(JSON.parse(archived.record.entity_counts_json)).toEqual({
        players: 25,
        clubs: 1,
      });
      expect(loadArchivedSnapshot(archived.record)).toEqual(payload);
      expect(verifyArchivedSnapshot(archived.record)).toBeNull();
      expect(
        fs.readdirSync(path.dirname(archived.record.raw_path))
          .filter((file) => file.endsWith('.tmp')),
      ).toEqual([]);
      if (process.platform !== 'win32') {
        expect(fs.statSync(archived.record.raw_path).mode & 0o777).toBe(0o600);
      }
    } finally {
      db.close();
    }
  });

  it('detects corruption and missing raw files', () => {
    const directory = temporaryDirectory();
    const db = createCareerDatabase(directory);
    try {
      const { record } = archiveSnapshot(db, {
        careerId: 1,
        directory: path.join(directory, 'snapshots'),
        reason: 'pre_match',
        payload: 'original',
        takenAt: 1234,
        protocol: 1,
      });
      fs.writeFileSync(record.raw_path, 'tampered');
      expect(verifyArchivedSnapshot(record)).toMatchObject({ code: 'checksum_mismatch' });
      fs.unlinkSync(record.raw_path);
      expect(verifyArchivedSnapshot(record)).toMatchObject({ code: 'missing' });
    } finally {
      db.close();
    }
  });

  it('removes the raw file if the database row cannot commit', () => {
    const directory = temporaryDirectory();
    const db = createCareerDatabase(directory);
    try {
      expect(() => archiveSnapshot(db, {
        careerId: 999,
        directory: path.join(directory, 'snapshots'),
        reason: 'career_loaded',
        payload: 'orphan',
        takenAt: 1234,
        protocol: 1,
      })).toThrow();
      expect(fs.readdirSync(path.join(directory, 'snapshots'))).toEqual([]);
    } finally {
      db.close();
    }
  });
});
