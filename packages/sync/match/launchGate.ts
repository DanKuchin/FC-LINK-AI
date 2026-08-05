export type PreMatchSnapshotState =
  | 'missing'
  | 'capturing'
  | 'ready'
  | 'stale'
  | 'wrong_save'
  | 'corrupt';

export interface LaunchGateInput {
  readonly checkpointVerified: boolean;
  readonly snapshotState: PreMatchSnapshotState;
  /** Must come from a visible user choice; it is never inferred from failure. */
  readonly manualResultModeConfirmed: boolean;
}

export type LaunchGateDecision =
  | {
    readonly allowed: true;
    readonly mode: 'snapshot_diff' | 'manual_result';
    readonly reason: string;
  }
  | {
    readonly allowed: false;
    readonly reason: string;
    readonly action: string;
    readonly deepLink: string;
  };

const SNAPSHOT_PROBLEMS: Readonly<Record<
  Exclude<PreMatchSnapshotState, 'ready'>,
  { readonly reason: string; readonly action: string; readonly deepLink: string }
>> = {
  missing: {
    reason: 'No verified pre-match snapshot exists for this fixture.',
    action: 'Take the pre-match snapshot or explicitly choose manual-result mode.',
    deepLink: 'tenure://match-prep/snapshot',
  },
  capturing: {
    reason: 'The pre-match snapshot is still being captured.',
    action: 'Wait for checksum verification before launching FC.',
    deepLink: 'tenure://match-prep/snapshot',
  },
  stale: {
    reason: 'The pre-match snapshot predates the current in-game date.',
    action: 'Capture a fresh snapshot or explicitly choose manual-result mode.',
    deepLink: 'tenure://sync-doctor/snapshot',
  },
  wrong_save: {
    reason: 'The pre-match snapshot belongs to a different FC career.',
    action: 'Connect the expected career before taking a new snapshot.',
    deepLink: 'tenure://sync-doctor/save-identity',
  },
  corrupt: {
    reason: 'The pre-match snapshot failed checksum verification.',
    action: 'Discard it and capture a new snapshot; never launch against corrupt evidence.',
    deepLink: 'tenure://sync-doctor/snapshots/corrupt',
  },
};

export function evaluateLaunchGate(input: LaunchGateInput): LaunchGateDecision {
  if (!input.checkpointVerified) {
    return {
      allowed: false,
      reason: 'The pre-match companion checkpoint is missing or failed verification.',
      action: 'Create and verify the pre-match checkpoint before launching FC.',
      deepLink: 'tenure://match-prep/checkpoint',
    };
  }
  if (input.snapshotState === 'ready') {
    return {
      allowed: true,
      mode: 'snapshot_diff',
      reason: 'The verified pre-match snapshot will protect post-match extraction.',
    };
  }
  if (input.manualResultModeConfirmed) {
    return {
      allowed: true,
      mode: 'manual_result',
      reason: 'Manual-result mode was explicitly selected; no snapshot diff will be claimed.',
    };
  }
  return { allowed: false, ...SNAPSHOT_PROBLEMS[input.snapshotState] };
}

export function assertLaunchAllowed(input: LaunchGateInput): Extract<
  LaunchGateDecision,
  { readonly allowed: true }
> {
  const decision = evaluateLaunchGate(input);
  if (!decision.allowed) throw new Error(`${decision.reason} ${decision.action}`);
  return decision;
}
