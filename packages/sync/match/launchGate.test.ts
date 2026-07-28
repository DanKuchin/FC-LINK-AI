import { describe, expect, it } from 'vitest';
import {
  assertLaunchAllowed,
  evaluateLaunchGate,
  type PreMatchSnapshotState,
} from './launchGate.js';

describe('pre-match launch gate', () => {
  it('allows snapshot-diff mode only with a verified checkpoint and ready snapshot', () => {
    expect(evaluateLaunchGate({
      checkpointVerified: true,
      snapshotState: 'ready',
      manualResultModeConfirmed: false,
    })).toMatchObject({ allowed: true, mode: 'snapshot_diff' });
  });

  it('requires the checkpoint even when manual-result mode was selected', () => {
    const decision = evaluateLaunchGate({
      checkpointVerified: false,
      snapshotState: 'missing',
      manualResultModeConfirmed: true,
    });
    expect(decision).toMatchObject({ allowed: false });
    expect(() => assertLaunchAllowed({
      checkpointVerified: false,
      snapshotState: 'missing',
      manualResultModeConfirmed: true,
    })).toThrow(/checkpoint/);
  });

  it.each([
    'missing',
    'capturing',
    'stale',
    'wrong_save',
    'corrupt',
  ] as const)('allows an explicit manual fallback for %s snapshot state', (snapshotState) => {
    expect(evaluateLaunchGate({
      checkpointVerified: true,
      snapshotState,
      manualResultModeConfirmed: true,
    })).toMatchObject({ allowed: true, mode: 'manual_result' });
  });

  it.each([
    'missing',
    'capturing',
    'stale',
    'wrong_save',
    'corrupt',
  ] as const)('blocks %s without manual confirmation and offers recovery', (snapshotState) => {
    const decision = evaluateLaunchGate({
      checkpointVerified: true,
      snapshotState,
      manualResultModeConfirmed: false,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.action.length).toBeGreaterThan(20);
      expect(decision.deepLink).toMatch(/^tenure:\/\//);
    }
  });

  it('has an exhaustive named decision for every snapshot state', () => {
    const states: readonly PreMatchSnapshotState[] = [
      'missing', 'capturing', 'ready', 'stale', 'wrong_save', 'corrupt',
    ];
    expect(states.map((snapshotState) => evaluateLaunchGate({
      checkpointVerified: true,
      snapshotState,
      manualResultModeConfirmed: false,
    }).allowed)).toEqual([false, false, true, false, false, false]);
  });
});
