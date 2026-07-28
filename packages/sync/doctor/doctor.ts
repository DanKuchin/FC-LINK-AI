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

export function diagnoseSync(input: DoctorInput): DoctorCondition[] {
  const helloTimeout = input.helloTimeoutMs ?? 15_000;
  const helloMissing = input.helloSeenAt === undefined ||
    input.helloSeenAt === null ||
    input.now - input.helloSeenAt > helloTimeout;
  const wrongSave = Boolean(
    input.expectedSaveUid &&
    input.connectedSaveUid &&
    input.expectedSaveUid !== input.connectedSaveUid,
  );
  const staleExport = input.snapshotInGameDate !== undefined &&
    input.snapshotInGameDate !== null &&
    input.currentInGameDate !== undefined &&
    input.currentInGameDate !== null &&
    input.snapshotInGameDate < input.currentInGameDate;

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
    condition('lua_not_running', helloMissing, {
      title: 'Lua bridge connection',
      cause: helloMissing
        ? `No bridge hello was received within ${helloTimeout} ms.`
        : 'The Lua bridge is connected.',
      offer: helloMissing
        ? 'Reinstall the bridge script and follow the exact Lua Engine run steps.'
        : 'No action needed.',
      deepLink: 'tenure://sync-doctor/bridge',
    }),
    condition('career_not_loaded', input.inCareer === false, {
      title: 'Career mode state',
      cause: input.inCareer === false ? 'FC reports that no career is loaded.' : 'A career is loaded.',
      offer: input.inCareer === false ? 'Load your career in FC, then retry.' : 'No action needed.',
      deepLink: 'tenure://sync-doctor/career',
    }),
    condition('wrong_save', wrongSave, {
      title: 'Connected career identity',
      cause: wrongSave
        ? `Connected save ${input.connectedSaveUid ?? '(missing)'} does not match the open Tenure career.`
        : 'The connected save matches the open Tenure career.',
      offer: wrongSave ? 'Switch to the expected FC career or abort this connection.' : 'No action needed.',
      deepLink: 'tenure://sync-doctor/save-identity',
    }),
    condition('stale_export', staleExport, {
      title: 'Snapshot freshness',
      cause: staleExport
        ? 'The newest snapshot predates the current in-game date.'
        : 'The newest snapshot is current.',
      offer: staleExport ? 'Take a new snapshot before continuing.' : 'No action needed.',
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
    condition('entity_mapping_conflict', (input.mappingConflicts ?? 0) > 0, {
      title: 'Entity mappings',
      cause: (input.mappingConflicts ?? 0) > 0
        ? `${input.mappingConflicts ?? 0} entity mapping conflict(s) need review.`
        : 'No entity mapping conflicts are open.',
      offer: (input.mappingConflicts ?? 0) > 0
        ? 'Review and resolve each ambiguous mapping individually.'
        : 'No action needed.',
      deepLink: 'tenure://sync-doctor/mappings',
      count: input.mappingConflicts ?? 0,
    }),
    condition('failed_write', (input.failedWrites ?? 0) > 0, {
      title: 'Failed writes',
      cause: (input.failedWrites ?? 0) > 0
        ? `${input.failedWrites ?? 0} write operation(s) failed or did not read back correctly.`
        : 'No write operations have failed.',
      offer: (input.failedWrites ?? 0) > 0
        ? 'Retry, abandon, or restore the named pre-write checkpoint.'
        : 'No action needed.',
      deepLink: 'tenure://sync-doctor/writes/failed',
      count: input.failedWrites ?? 0,
    }),
    condition('missing_acknowledgement', (input.sentWithoutAck ?? 0) > 0, {
      title: 'Missing acknowledgements',
      cause: (input.sentWithoutAck ?? 0) > 0
        ? `${input.sentWithoutAck ?? 0} sent operation(s) have no acknowledgement.`
        : 'Every sent operation has an acknowledgement or remains inside its timeout.',
      offer: (input.sentWithoutAck ?? 0) > 0
        ? 'Keep the instruction pending and verify its observed value on the next load.'
        : 'No action needed.',
      deepLink: 'tenure://sync-doctor/writes/unacknowledged',
      count: input.sentWithoutAck ?? 0,
    }),
    condition('corrupted_snapshot', (input.corruptedSnapshots ?? 0) > 0, {
      title: 'Snapshot integrity',
      cause: (input.corruptedSnapshots ?? 0) > 0
        ? `${input.corruptedSnapshots ?? 0} snapshot(s) failed checksum verification.`
        : 'All retained snapshots pass checksum verification.',
      offer: (input.corruptedSnapshots ?? 0) > 0
        ? 'Discard the corrupt snapshot and take a new one; never import it.'
        : 'No action needed.',
      deepLink: 'tenure://sync-doctor/snapshots/corrupt',
      count: input.corruptedSnapshots ?? 0,
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
