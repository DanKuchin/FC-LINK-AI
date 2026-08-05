import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../../../../packages/persistence/db.js';
import { migrate } from '../../../../../packages/persistence/migrate.js';
import { SquadService } from './squadService.js';

function day(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

let directory: string;
let careerPath: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tenure-squad-service-'));
  careerPath = path.join(directory, 'career.db');
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('desktop squad service', () => {
  it('returns the managed squad with ranges, contract, condition and personality evidence', () => {
    const currentDate = day('2026-08-01');
    const db = openDatabase(careerPath);
    migrate(db, { now: 1 });
    db.run(
      `INSERT INTO careers (
        id, name, save_uid, master_seed, current_date, schema_version, created_at, updated_at
      ) VALUES (1, 'Squad', 'save-1', 'seed', ?, 3, 1, 1)`,
      currentDate,
    );
    db.run(
      `INSERT INTO clubs (id, career_id, name, created_at, updated_at)
       VALUES
         (1, 1, 'Managed FC', 1, 1),
         (2, 1, 'Other FC', 1, 1)`,
    );
    db.run('UPDATE careers SET managed_club_id = 1 WHERE id = 1');
    db.run(
      `INSERT INTO players (
        id, career_id, club_id, first_name, last_name, known_as, birth_date,
        primary_position, current_ability, potential_low, potential_high,
        status, created_at, updated_at
      ) VALUES
        (1, 1, 1, 'Alex', 'Example', NULL, ?, 'CM', 78, 80, 84, 'active', 1, 1),
        (2, 1, 1, 'Sam', 'Range', 'S. Range', ?, 'ST', NULL, NULL, NULL, 'active', 1, 1),
        (3, 1, 2, 'Other', 'Club', NULL, ?, 'GK', 70, 70, 72, 'active', 1, 1),
        (4, 1, 1, 'Retired', 'Player', NULL, ?, 'CB', 70, 70, 72, 'retired', 1, 1)`,
      day('2000-08-02'),
      day('2004-01-01'),
      day('1998-01-01'),
      day('1980-01-01'),
    );
    db.run(
      `INSERT INTO player_attributes (
        player_id, fitness, sharpness, form, morale, updated_at
      ) VALUES (1, 91, 50, 67, 72, 1)`,
    );
    db.run(
      `INSERT INTO player_personalities (
        player_id, professionalism, ambition, loyalty, consistency, pressure, seed
      ) VALUES (1, 80, 70, 60, 75, 68, 'personality-seed')`,
    );
    db.run(
      `INSERT INTO contracts (
        id, career_id, player_id, club_id, kind, wage, wage_is_estimated,
        start_date, end_date, squad_role, status, external_source
      ) VALUES (1, 1, 1, 1, 'permanent', 125000, 1, ?, ?, 'important', 'active', 'fc')`,
      day('2025-07-01'),
      day('2029-06-30'),
    );
    db.run(
      `INSERT INTO scouting_reports (
        id, career_id, player_id, ability_low, ability_high,
        potential_low, potential_high, confidence, written_on
      ) VALUES (1, 1, 2, 61, 66, 74, 82, 0.6, ?)`,
      currentDate - 2,
    );
    db.close();

    const squad = new SquadService({ careerPath }).get();
    expect(squad).toMatchObject({
      source: 'career',
      clubName: 'Managed FC',
      currentDate,
    });
    expect(squad.players).toHaveLength(2);
    expect(squad.players[0]).toEqual({
      id: 1,
      name: 'Alex Example',
      position: 'CM',
      age: 25,
      abilityLow: 78,
      abilityHigh: 78,
      potentialLow: 80,
      potentialHigh: 84,
      fitness: 91,
      form: 67,
      morale: 72,
      contractEnd: day('2029-06-30'),
      squadRole: 'important',
      wage: 125000,
      wageEstimated: true,
      personality: {
        professionalism: 80,
        ambition: 70,
        loyalty: 60,
        consistency: 75,
        pressure: 68,
        seed: 'personality-seed',
      },
    });
    expect(squad.players[1]).toMatchObject({
      id: 2,
      name: 'S. Range',
      abilityLow: 61,
      abilityHigh: 66,
      potentialLow: 74,
      potentialHigh: 82,
      fitness: null,
      personality: null,
    });
  });

  it('returns an explicit unavailable state without creating a database', () => {
    expect(new SquadService({ careerPath }).get()).toEqual({
      source: 'unavailable',
      clubName: null,
      currentDate: null,
      players: [],
    });
    expect(fs.existsSync(careerPath)).toBe(false);
  });
});
