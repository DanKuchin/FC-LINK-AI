import fs from 'node:fs';
import { openDatabase } from '@tenure/persistence/db.js';
import type {
  SquadPlayerView,
  SquadView,
} from '../../shared/ipc.js';

export interface SquadServiceOptions {
  readonly careerPath: string;
}

interface CareerRow {
  readonly id: number;
  readonly current_date: number;
  readonly managed_club_id: number | null;
  readonly club_name: string | null;
}

interface SquadRow {
  readonly id: number;
  readonly name: string;
  readonly primary_position: string;
  readonly birth_date: number;
  readonly ability_low: number | null;
  readonly ability_high: number | null;
  readonly potential_low: number | null;
  readonly potential_high: number | null;
  readonly fitness: number | null;
  readonly form: number | null;
  readonly morale: number | null;
  readonly contract_end: number | null;
  readonly squad_role: string | null;
  readonly wage: number | null;
  readonly wage_is_estimated: number | null;
  readonly professionalism: number | null;
  readonly ambition: number | null;
  readonly loyalty: number | null;
  readonly consistency: number | null;
  readonly pressure: number | null;
  readonly personality_seed: string | null;
}

function dateFromDay(day: number): Date {
  return new Date(day * 86_400_000);
}

function ageOn(birthDay: number, currentDay: number): number {
  const birth = dateFromDay(birthDay);
  const current = dateFromDay(currentDay);
  let age = current.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    current.getUTCMonth() < birth.getUTCMonth() ||
    (current.getUTCMonth() === birth.getUTCMonth() &&
      current.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return Math.max(0, age);
}

function personality(row: SquadRow): SquadPlayerView['personality'] {
  const values = [
    row.professionalism,
    row.ambition,
    row.loyalty,
    row.consistency,
    row.pressure,
  ];
  if (row.personality_seed === null || values.some((value) => value === null)) return null;
  return {
    professionalism: row.professionalism as number,
    ambition: row.ambition as number,
    loyalty: row.loyalty as number,
    consistency: row.consistency as number,
    pressure: row.pressure as number,
    seed: row.personality_seed,
  };
}

export class SquadService {
  private readonly options: SquadServiceOptions;

  constructor(options: SquadServiceOptions) {
    this.options = options;
  }

  get(): SquadView {
    if (!fs.existsSync(this.options.careerPath)) return this.unavailable();
    const db = openDatabase(this.options.careerPath);
    try {
      const career = db.get<CareerRow>(
        `SELECT
          careers.id,
          careers.current_date AS current_date,
          careers.managed_club_id,
          clubs.name AS club_name
         FROM careers
         LEFT JOIN clubs ON clubs.id = careers.managed_club_id
         ORDER BY careers.id
         LIMIT 1`,
      );
      if (career === undefined || career.managed_club_id === null) return this.unavailable();
      const rows = db.all<SquadRow>(
        `SELECT
          players.id,
          COALESCE(
            NULLIF(players.known_as, ''),
            NULLIF(TRIM(
              COALESCE(players.first_name, '') || ' ' ||
              COALESCE(players.last_name, '')
            ), ''),
            'Unnamed player'
          ) AS name,
          players.primary_position,
          players.birth_date,
          COALESCE(players.current_ability, report.ability_low) AS ability_low,
          COALESCE(players.current_ability, report.ability_high) AS ability_high,
          COALESCE(players.potential_low, report.potential_low) AS potential_low,
          COALESCE(players.potential_high, report.potential_high) AS potential_high,
          attributes.fitness,
          attributes.form,
          attributes.morale,
          contract.end_date AS contract_end,
          contract.squad_role,
          contract.wage,
          contract.wage_is_estimated,
          personality.professionalism,
          personality.ambition,
          personality.loyalty,
          personality.consistency,
          personality.pressure,
          personality.seed AS personality_seed
         FROM players
         LEFT JOIN player_attributes attributes ON attributes.player_id = players.id
         LEFT JOIN player_personalities personality ON personality.player_id = players.id
         LEFT JOIN contracts contract ON contract.id = (
           SELECT candidate.id
           FROM contracts candidate
           WHERE candidate.player_id = players.id
             AND candidate.status = 'active'
           ORDER BY
             CASE candidate.kind WHEN 'permanent' THEN 0 WHEN 'loan' THEN 1 ELSE 2 END,
             candidate.end_date DESC,
             candidate.id DESC
           LIMIT 1
         )
         LEFT JOIN scouting_reports report ON report.id = (
           SELECT candidate.id
           FROM scouting_reports candidate
           WHERE candidate.player_id = players.id
           ORDER BY candidate.written_on DESC, candidate.id DESC
           LIMIT 1
         )
         WHERE players.career_id = ?
           AND players.club_id = ?
           AND players.status = 'active'
           AND players.deleted_at IS NULL
         ORDER BY players.last_name, players.first_name, players.id`,
        career.id,
        career.managed_club_id,
      );
      return {
        source: 'career',
        clubName: career.club_name,
        currentDate: career.current_date,
        players: rows.map((row) => ({
          id: row.id,
          name: row.name,
          position: row.primary_position,
          age: ageOn(row.birth_date, career.current_date),
          abilityLow: row.ability_low,
          abilityHigh: row.ability_high,
          potentialLow: row.potential_low,
          potentialHigh: row.potential_high,
          fitness: row.fitness,
          form: row.form,
          morale: row.morale,
          contractEnd: row.contract_end,
          squadRole: row.squad_role,
          wage: row.wage,
          wageEstimated: row.wage_is_estimated === 1,
          personality: personality(row),
        })),
      };
    } finally {
      db.close();
    }
  }

  private unavailable(): SquadView {
    return {
      source: 'unavailable',
      clubName: null,
      currentDate: null,
      players: [],
    };
  }
}
