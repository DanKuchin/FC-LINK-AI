import type { Db } from './db.js';

export interface DiagnosticRunInput {
  readonly careerId?: number | null;
  readonly createdAt: number;
  readonly summary: unknown;
  readonly bundlePath?: string | null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 'null' : encoded;
}

export function recordDiagnosticRun(db: Db, input: DiagnosticRunInput): number {
  const result = db.run(
    `INSERT INTO diagnostic_runs (career_id, created_at, summary_json, bundle_path)
     VALUES (?, ?, ?, ?)`,
    input.careerId ?? null,
    input.createdAt,
    stableJson(input.summary),
    input.bundlePath ?? null,
  );
  return Number(result.lastInsertRowid);
}
