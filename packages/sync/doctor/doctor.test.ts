import { describe, expect, it } from 'vitest';
import type { Verdict } from '../compat/manifest.js';
import { diagnoseSync, doctorSummary, type DoctorInput } from './doctor.js';

const supported: Verdict = {
  state: 'supported',
  readsEnabled: true,
  writesEnabled: true,
  reason: 'This version pair has been tested and is supported.',
  requiredLiveEditor: { min: 'v1', max: 'v1' },
};

function healthy(overrides: Partial<DoctorInput> = {}): DoctorInput {
  return {
    fcFound: true,
    liveEditorFound: true,
    compatibility: supported,
    now: 100_000,
    helloSeenAt: 99_999,
    inCareer: true,
    expectedSaveUid: 'save-1',
    connectedSaveUid: 'save-1',
    snapshotInGameDate: 20_000,
    currentInGameDate: 20_000,
    mappingConflicts: 0,
    failedWrites: 0,
    sentWithoutAck: 0,
    corruptedSnapshots: 0,
    ...overrides,
  };
}

describe('Sync Doctor', () => {
  it('reports all twelve documented failure classes with an action and deep link', () => {
    const ids = diagnoseSync(healthy()).map((item) => item.id);
    expect(ids).toEqual([
      'fc_not_found',
      'live_editor_not_found',
      'unsupported_version_pair',
      'lua_not_running',
      'career_not_loaded',
      'wrong_save',
      'stale_export',
      'permission_or_av_block',
      'entity_mapping_conflict',
      'failed_write',
      'missing_acknowledgement',
      'corrupted_snapshot',
    ]);
    for (const item of diagnoseSync(healthy())) {
      expect(item.state).toBe('ok');
      expect(item.cause.length).toBeGreaterThan(10);
      expect(item.offer.length).toBeGreaterThan(10);
      expect(item.deepLink).toMatch(/^tenure:\/\/sync-doctor\//);
    }
  });

  it.each([
    ['fc_not_found', { fcFound: false }],
    ['live_editor_not_found', { liveEditorFound: false }],
    ['lua_not_running', { helloSeenAt: 1 }],
    ['career_not_loaded', { inCareer: false }],
    ['wrong_save', { connectedSaveUid: 'other-save' }],
    ['stale_export', { snapshotInGameDate: 19_999 }],
    ['permission_or_av_block', { bridgeAccessError: 'EACCES C:\\Tenure' }],
    ['entity_mapping_conflict', { mappingConflicts: 2 }],
    ['failed_write', { failedWrites: 1 }],
    ['missing_acknowledgement', { sentWithoutAck: 1 }],
    ['corrupted_snapshot', { corruptedSnapshots: 1 }],
  ] as const)('detects %s', (expectedId, override) => {
    const failed = diagnoseSync(healthy(override))
      .filter((item) => item.state === 'error');
    expect(failed.map((item) => item.id)).toEqual([expectedId]);
    expect(doctorSummary(failed).state).toBe('error');
  });

  it('treats an untested plausible pair as a warning and an unsupported pair as an error', () => {
    const untested: Verdict = {
      ...supported,
      state: 'untested',
      writesEnabled: false,
      reason: 'This plausible pair is untested, so writes are disabled.',
    };
    const warning = diagnoseSync(healthy({ compatibility: untested }))
      .find((item) => item.id === 'unsupported_version_pair');
    expect(warning?.state).toBe('warning');

    const unsupported: Verdict = {
      ...untested,
      state: 'unsupported',
      readsEnabled: false,
      reason: 'This pair is unsupported.',
    };
    const error = diagnoseSync(healthy({ compatibility: unsupported }))
      .find((item) => item.id === 'unsupported_version_pair');
    expect(error?.state).toBe('error');
  });
});
