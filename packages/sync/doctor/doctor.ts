import type { Verdict } from '../compat/manifest.js';

export type DoctorConditionId =
  | 'fc_not_found'
  | 'live_editor_not_found'
  | 'unsupported_version_pair'
  | 'lua_not_running'
  | 'career_not_loaded'
  | 'wrong_save'
  | 'stale_export'
  | 'permission_or_av_block'
  | 'entity_mapping_conflict'
  | 'failed_write'
  | 'missing_acknowledgement'
  | 'corrupted_snapshot';

export interface DoctorCondition {
  readonly id: DoctorConditionId;
  readonly state: 'ok' | 'warning' | 'error';
  readonly title: string;
  readonly cause: string;
  readonly offer: string;
  readonly deepLink: string;
  readonly count?: number;
}

export interface DoctorInput {
  readonly fcFound: boolean;
  readonly liveEditorFound: boolean;
  readonly compatibility: Verdict;
  readonly now: number;
  readonly bridgeStartedAt?: number | null;
  readonly helloSeenAt?: number | null;
  readonly helloTimeoutMs?: number;
  readonly inCareer?: boolean | null;
  readonly expectedSaveUid?: string | null;
  readonly connectedSaveUid?: string | null;
  readonly snapshotInGameDate?: number | null;
  readonly currentInGameDate?: number | null;
  readonly bridgeAccessError?: string | null;
  readonly mappingConflicts?: number;
  readonly failedWrites?: number;
  readonly sentWithoutAck?: number;
  readonly corruptedSnapshots?: number;
}

function condition(
  id: DoctorConditionId,
  failing: boolean,
  details: Omit<DoctorCondition, 'id' | 'state'>,
  warning = false,
): DoctorCondition {
  return {
    id,
    state: failing ? (warning ? 'warning' : 'error') : 'ok',
    ...details,
  };
}

function unavailable(
  id: DoctorConditionId,
  details: Omit<DoctorCondition, 'id' | 'state'>,
): DoctorCondition {
  return {
    id,
    state: 'warning',
    ...details,
  };
}

export function diagnoseSync(input: DoctorInput): DoctorCondition[] {
  const helloTimeout = input.helloTimeoutMs ?? 15_000;
  const helloMissing = input.helloSeenAt === undefined || input.helloSeenAt === null;
  const waitingForHello = helloMissing &&
    input.bridgeStartedAt !== undefined &&
    input.bridgeStartedAt !== null &&
    input.now - input.bridgeStartedAt <= helloTimeout;
  const saveIdentityAvailable = Boolean(input.expectedSaveUid && input.connectedSaveUid);
  const wrongSave = saveIdentityAvailable &&
    input.expectedSaveUid !== input.connectedSaveUid;
  const snapshotDateAvailable = input.snapshotInGameDate !== undefined &&
    input.snapshotInGameDate !== null;
  const currentDateAvailable = input.currentInGameDate !== undefined &&
    input.currentInGameDate !== null;
  const staleExport = snapshotDateAvailable &&
    currentDateAvailable &&
    (input.snapshotInGameDate as number) < (input.currentInGameDate as number);

  return [
    condition('fc_not_found', !input.fcFound, {
      title: 'EA Sports FC 26 installation',
      cause: input.fcFound
        ? 'FC 26 is available.'
        : 'FC 26 was not found in the registry or known installation paths.',
      offer: input.fcFound ? 'No action needed.' : 'Browse to the FC 26 installation manually.',
      deepLink: 'tenure://sync-doctor/fc-installation',
    }),
    condition('live_editor_not_found', !input.liveEditorFound, {
      title: 'FC Live Editor installation',
      cause: input.liveEditorFound
        ? 'FC Live Editor is available.'
        : 'The FC Live Editor launcher was not found.',
      offer: input.liveEditorFound
        ? 'No action needed.'
        : 'Open the official FC Live Editor source and select its launcher.',
      deepLink: 'tenure://sync-doctor/live-editor',
    }),
    condition('unsupported_version_pair', input.compatibility.state !== 'supported', {
      title: 'Game and Live Editor compatibility',
      cause: input.compatibility.reason,
      offer: input.compatibility.state === 'unsupported'
        ? 'Continue offline until the version pair is supported.'
        : input.compatibility.state === 'untested'
          ? 'Continue read-only while writes remain disabled for this untested pair.'
          : 'No action needed.',
      deepLink: 'tenure://sync-doctor/compatibility',
    }, input.compatibility.state === 'untested'),
    waitingForHello
      ? unavailable('lua_not_running', {
        title: 'Lua bridge connection',
        cause: `Waiting up to ${helloTimeout} ms for the first Lua bridge hello.`,
        offer: 'Start the Tenure bridge from Live Editor while the career is loaded.',
        deepLink: 'tenure://sync-doctor/bridge',
      })
      : condition('lua_not_running', helloMissing, {
        title: 'Lua bridge connection',
        cause: helloMissing
          ? `No bridge hello was received within ${helloTimeout} ms of desktop startup.`
          : 'A Lua bridge hello was received during this desktop session.',
        offer: helloMissing
          ? 'Reinstall the bridge script and follow the exact Lua Engine run steps.'
          : 'No action needed.',
        deepLink: 'tenure://sync-doctor/bridge',
      }),
    input.inCareer === undefined || input.inCareer === null
      ? unavailable('career_not_loaded', {
        title: 'Career mode state',
        cause: 'Career state is unavailable until the Lua bridge reports it.',
        offer: 'Start the bridge in FC, then re-test this condition.',
        deepLink: 'tenure://sync-doctor/career',
      })
      : condition('career_not_loaded', input.inCareer === false, {
        title: 'Career mode state',
        cause: input.inCareer === false ? 'FC reports that no career is loaded.' : 'A career is loaded.',
        offer: input.inCareer === false ? 'Load your career in FC, then retry.' : 'No action needed.',
        deepLink: 'tenure://sync-doctor/career',
      }),
    saveIdentityAvailable
      ? condition('wrong_save', wrongSave, {
        title: 'Connected career identity',
        cause: wrongSave
          ? `Connected save ${input.connectedSaveUid ?? '(missing)'} does not match the open Tenure career.`
          : 'The connected save matches the open Tenure career.',
        offer: wrongSave ? 'Switch to the expected FC career or abort this connection.' : 'No action needed.',
        deepLink: 'tenure://sync-doctor/save-identity',
      })
      : unavailable('wrong_save', {
        title: 'Connected career identity',
        cause: 'Both an open Tenure career and a connected FC save are required for identity comparison.',
        offer: 'Open the companion career and connect the Lua bridge before continuing.',
        deepLink: 'tenure://sync-doctor/save-identity',
      }),
    snapshotDateAvailable && currentDateAvailable
      ? condition('stale_export', staleExport, {
        title: 'Snapshot freshness',
        cause: staleExport
          ? 'The newest snapshot predates the current in-game date.'
          : 'The newest snapshot is current.',
        offer: staleExport ? 'Take a new snapshot before continuing.' : 'No action needed.',
        deepLink: 'tenure://sync-doctor/snapshot',
      })
      : unavailable('stale_export', {
        title: 'Snapshot freshness',
        cause: 'No retained snapshot and career date are available for comparison.',
        offer: 'Open a career and take a new snapshot before relying on imported data.',
        deepLink: 'tenure://sync-doctor/snapshot',
      }),
    condition('permission_or_av_block', Boolean(input.bridgeAccessError), {
      title: 'Local bridge access',
      cause: input.bridgeAccessError ?? 'No file, permission, port, or antivirus error is active.',
      offer: input.bridgeAccessError
        ? 'Review the exact blocked folder or port and add only the required exclusion.'
        : 'No action needed.',
      deepLink: 'tenure://sync-doctor/local-access',
    }),
    input.mappingConflicts === undefined
      ? unavailable('entity_mapping_conflict', {
        title: 'Entity mappings',
        cause: 'Entity mapping state is unavailable because no active career database is open.',
        offer: 'Open a Tenure career before reviewing mapping conflicts.',
        deepLink: 'tenure://sync-doctor/mappings',
      })
      : condition('entity_mapping_conflict', input.mappingConflicts > 0, {
      title: 'Entity mappings',
      cause: input.mappingConflicts > 0
        ? `${input.mappingConflicts} entity mapping conflict(s) need review.`
        : 'No entity mapping conflicts are open.',
      offer: input.mappingConflicts > 0
        ? 'Review and resolve each ambiguous mapping individually.'
        : 'No action needed.',
      deepLink: 'tenure://sync-doctor/mappings',
      count: input.mappingConflicts,
    }),
    input.failedWrites === undefined
      ? unavailable('failed_write', {
        title: 'Failed writes',
        cause: 'Write history is unavailable because no active career database is open.',
        offer: 'Open a Tenure career before reviewing write failures.',
        deepLink: 'tenure://sync-doctor/writes/failed',
      })
      : condition('failed_write', input.failedWrites > 0, {
      title: 'Failed writes',
      cause: input.failedWrites > 0
        ? `${input.failedWrites} write operation(s) failed or did not read back correctly.`
        : 'No write operations have failed.',
      offer: input.failedWrites > 0
        ? 'Retry, abandon, or restore the named pre-write checkpoint.'
        : 'No action needed.',
      deepLink: 'tenure://sync-doctor/writes/failed',
      count: input.failedWrites,
    }),
    input.sentWithoutAck === undefined
      ? unavailable('missing_acknowledgement', {
        title: 'Missing acknowledgements',
        cause: 'Acknowledgement history is unavailable because no active career database is open.',
        offer: 'Open a Tenure career before reviewing pending acknowledgements.',
        deepLink: 'tenure://sync-doctor/writes/unacknowledged',
      })
      : condition('missing_acknowledgement', input.sentWithoutAck > 0, {
      title: 'Missing acknowledgements',
      cause: input.sentWithoutAck > 0
        ? `${input.sentWithoutAck} sent operation(s) have no acknowledgement.`
        : 'Every sent operation has an acknowledgement or remains inside its timeout.',
      offer: input.sentWithoutAck > 0
        ? 'Keep the instruction pending and verify its observed value on the next load.'
        : 'No action needed.',
      deepLink: 'tenure://sync-doctor/writes/unacknowledged',
      count: input.sentWithoutAck,
    }),
    input.corruptedSnapshots === undefined
      ? unavailable('corrupted_snapshot', {
        title: 'Snapshot integrity',
        cause: 'Snapshot integrity is unavailable because no active career database is open.',
        offer: 'Open a Tenure career before relying on retained snapshot evidence.',
        deepLink: 'tenure://sync-doctor/snapshots/corrupt',
      })
      : condition('corrupted_snapshot', input.corruptedSnapshots > 0, {
      title: 'Snapshot integrity',
      cause: input.corruptedSnapshots > 0
        ? `${input.corruptedSnapshots} snapshot(s) failed checksum verification.`
        : 'All retained snapshots pass checksum verification.',
      offer: input.corruptedSnapshots > 0
        ? 'Discard the corrupt snapshot and take a new one; never import it.'
        : 'No action needed.',
      deepLink: 'tenure://sync-doctor/snapshots/corrupt',
      count: input.corruptedSnapshots,
    }),
  ];
}

export function doctorSummary(conditions: readonly DoctorCondition[]): {
  readonly state: 'ok' | 'warning' | 'error';
  readonly errors: number;
  readonly warnings: number;
} {
  const errors = conditions.filter((item) => item.state === 'error').length;
  const warnings = conditions.filter((item) => item.state === 'warning').length;
  return {
    state: errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'ok',
    errors,
    warnings,
  };
}
