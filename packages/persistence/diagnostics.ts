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

export interface RestoreHistoryInput {
  readonly careerId?: number | null;
  readonly checkpointManifest: string;
  readonly restoredAt: number;
  readonly safetyCopyPath: string;
  readonly result: 'restored' | 'failed';
  readonly error?: string | null;
}

export function recordRestoreHistory(db: Db, input: RestoreHistoryInput): number {
  const result = db.run(
    `INSERT INTO restore_history (
      career_id, checkpoint_manifest, restored_at, safety_copy_path, result, error
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    input.careerId ?? null,
    input.checkpointManifest,
    input.restoredAt,
    input.safetyCopyPath,
    input.result,
    input.error ?? null,
  );
  return Number(result.lastInsertRowid);
}
