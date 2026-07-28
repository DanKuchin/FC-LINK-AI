import { describe, expect, it } from 'vitest';
import { gradePhaseZero } from '../spike/report-core.mjs';

function greenEvidence() {
  const cycle = (index: number) => ({
    recorder_version: 2,
    cycle_id: `cycle-${index}`,
    career_loaded: true,
    same_save_uid: true,
    save_uid: 'save-1',
    le_version: '26.3.5',
    all_originals_restored: true,
    tests: [{
      table: 'players',
      status: 'PERSISTED',
      restore_ok: true,
    }],
  });
  return {
    environment: {
      recorder_version: 2,
      platform: 'win32',
      game_build: '1.0.138.57785',
      required_le_for_build: ['26.3.5', '26.3.5'],
    },
    helloHistory: [{
      recorder_version: 2,
      body: { in_career: true, save_uid: 'save-1', le_version: '26.3.5' },
    }],
    schemaMeta: {
      recorder_version: 2,
      save_uid: 'save-1',
      le_version: '26.3.5',
    },
    schemaSummary: {
      recorder_version: 2,
      record: 'summary',
      tables: 100,
      total_rows_seen: 20_000,
    },
    timing: {
      recorder_version: 2,
      save_uid: 'save-1',
      le_version: '26.3.5',
      projected_full_import_ms: 45_000,
      tables: [
        { table: 'players', rows: 17_000 },
        { table: 'teams', rows: 700 },
      ],
    },
    fixtures: {
      recorder_version: 2,
      save_uid: 'save-1',
      le_version: '26.3.5',
      verdict: 'PASS',
      checks: { fixtures_found: 20, played_fixtures: 1 },
    },
    matchDiff: {
      recorder_version: 2,
      save_uid: 'save-1',
      le_version: '26.3.5',
      verified: true,
      played_match_count: 1,
      player_lines: 22,
    },
    persistenceHistory: Array.from({ length: 20 }, (_, index) => cycle(index)),
    transferWrite: {
      recorder_version: 2,
      save_uid: 'save-1',
      le_version: '26.3.5',
      durable: true,
      backup_restored: true,
    },
  };
}

describe('Phase 0 report grading', () => {
  it('keeps every gate unknown when no real evidence exists', () => {
    const result = gradePhaseZero({});
    expect(result.proceed).toBe(false);
    expect(result.gates).toHaveLength(11);
    expect(result.gates.every((gate) => gate.state === 'UNKNOWN')).toBe(true);
  });

  it('proceeds only when every technical and roadmap safeguard is proven', () => {
    const result = gradePhaseZero(greenEvidence());
    expect(result.proceed).toBe(true);
    expect(result.gates.every((gate) => gate.state === 'PASS')).toBe(true);
  });

  it('never promotes partial, concerning, or malformed evidence to proceed', () => {
    const evidence = greenEvidence();
    evidence.timing.projected_full_import_ms = 120_000;
    evidence.persistenceHistory = evidence.persistenceHistory.slice(0, 1);
    evidence.transferWrite.durable = false;
    const result = gradePhaseZero(evidence);

    expect(result.proceed).toBe(false);
    expect(result.gates.find((gate) => gate.id === 'snapshot_cost')?.state).toBe('FAIL');
    expect(result.gates.find((gate) => gate.id === 'clean_cycles')?.state).toBe('CONCERN');
    expect(result.gates.find((gate) => gate.id === 'transfer_write')?.state).toBe('FAIL');
  });

  it('requires restart evidence before calling a single hello UID stable', () => {
    const evidence = greenEvidence();
    evidence.persistenceHistory = [];
    const result = gradePhaseZero(evidence);
    expect(result.gates.find((gate) => gate.id === 'stable_uid')?.state).toBe('FAIL');
    expect(result.proceed).toBe(false);
  });

  it('rejects evidence mixed across saves or recorded by an older harness', () => {
    const evidence = greenEvidence();
    evidence.timing.save_uid = 'different-save';
    evidence.schemaMeta.recorder_version = 1;
    const result = gradePhaseZero(evidence);

    expect(result.gates.find((gate) => gate.id === 'schema')?.state).toBe('FAIL');
    expect(result.gates.find((gate) => gate.id === 'snapshot_cost')?.state).toBe('FAIL');
    expect(result.proceed).toBe(false);
  });

  it('rejects an unsupported platform or Live Editor version', () => {
    const evidence = greenEvidence();
    evidence.environment.platform = 'darwin';
    evidence.helloHistory[0]!.body.le_version = '26.3.4';
    const result = gradePhaseZero(evidence);

    expect(result.gates.find((gate) => gate.id === 'environment')?.state).toBe('FAIL');
    expect(result.proceed).toBe(false);
  });
});
