import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from './db.js';
import { recordDiagnosticRun } from './diagnostics.js';
import { migrate } from './migrate.js';

describe('diagnostic run history', () => {
  it('stores a deterministic summary and optional exported bundle path', () => {
    const db = openMemoryDatabase();
    migrate(db, { now: 1 });
    const id = recordDiagnosticRun(db, {
      createdAt: 10,
      summary: { warnings: 1, errors: 0 },
      bundlePath: 'C:\\Tenure\\exports\\diagnostics.zip',
    });
    const row = db.get<{
      id: number;
      summary_json: string;
      bundle_path: string;
    }>('SELECT id, summary_json, bundle_path FROM diagnostic_runs WHERE id = ?', id);
    expect(row).toEqual({
      id,
      summary_json: '{"errors":0,"warnings":1}',
      bundle_path: 'C:\\Tenure\\exports\\diagnostics.zip',
    });
    db.close();
  });
});
