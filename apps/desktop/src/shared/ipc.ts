export const IPC_CHANNELS = {
  versions: 'system:versions',
  syncStatus: 'sync:status',
  environmentGet: 'environment:get',
  environmentBrowseGame: 'environment:browse-game',
  environmentBrowseLiveEditor: 'environment:browse-live-editor',
  bridgeInstallPreview: 'bridge-install:preview',
  bridgeInstallApply: 'bridge-install:apply',
  resultPendingFixtures: 'result:pending-fixtures',
  resultFixturePlayers: 'result:fixture-players',
  resultCommitManual: 'result:commit-manual',
  resultCheckpointIssues: 'result:checkpoint-issues',
  resultRetryCheckpoint: 'result:retry-checkpoint',
  matchPrepState: 'match-prep:state',
  matchPrepCheckpoint: 'match-prep:checkpoint',
  checkpointList: 'checkpoint:list',
  checkpointRestore: 'checkpoint:restore',
  diagnosticExport: 'diagnostic:export',
  doctorConditions: 'doctor:conditions',
  squadGet: 'squad:get',
  compatibilityStatus: 'compatibility:status',
  compatibilityInstall: 'compatibility:install',
} as const;

export interface VersionSurface {
  readonly app: string;
  readonly saveSchema: number;
  readonly bridgeProtocol: number;
  readonly compatibilityManifest: number;
  readonly sqliteAvailable: boolean;
}

export interface SyncStatus {
  readonly state: 'connected' | 'offline' | 'attention';
  readonly label: string;
  readonly detail: string;
  readonly writesEnabled: boolean;
}

export interface DoctorConditionView {
  readonly id:
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
  readonly state: 'ok' | 'warning' | 'error';
  readonly title: string;
  readonly cause: string;
  readonly offer: string;
  readonly deepLink: string;
  readonly count?: number;
}

export interface EnvironmentSummary {
  readonly gameFound: boolean;
  readonly gamePath: string | null;
  readonly gameBuild: string | null;
  readonly liveEditorFound: boolean;
  readonly liveEditorPath: string | null;
  readonly liveEditorVersion: string | null;
  readonly requiredLiveEditor: readonly string[] | null;
  readonly problem: string | null;
}

export interface CompatibilityManifestSummary {
  readonly manifestVersion: number;
  readonly updatedAt: string;
  readonly source: 'bundled' | 'user';
  readonly overridePath: string;
  readonly problem: string | null;
}

export type CompatibilityManifestInstallResult =
  | {
    readonly cancelled: true;
    readonly status: CompatibilityManifestSummary;
  }
  | {
    readonly cancelled: false;
    readonly status: CompatibilityManifestSummary;
  };

export interface SquadPlayerView {
  readonly id: number;
  readonly name: string;
  readonly position: string;
  readonly age: number;
  readonly abilityLow: number | null;
  readonly abilityHigh: number | null;
  readonly potentialLow: number | null;
  readonly potentialHigh: number | null;
  readonly fitness: number | null;
  readonly form: number | null;
  readonly morale: number | null;
  readonly contractEnd: number | null;
  readonly squadRole: string | null;
  readonly wage: number | null;
  readonly wageEstimated: boolean;
  readonly personality: {
    readonly professionalism: number;
    readonly ambition: number;
    readonly loyalty: number;
    readonly consistency: number;
    readonly pressure: number;
    readonly seed: string;
  } | null;
}

export interface SquadView {
  readonly source: 'career' | 'unavailable';
  readonly clubName: string | null;
  readonly currentDate: number | null;
  readonly players: readonly SquadPlayerView[];
}

export interface BridgeInstallPreview {
  readonly files: readonly {
    readonly relativePath: string;
    readonly action: 'create' | 'update' | 'unchanged' | 'conflict';
    readonly diff: string;
  }[];
  readonly hasConflicts: boolean;
}

export interface BridgeInstallSummary {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly overwrittenConflicts: number;
}

export interface PendingFixture {
  readonly id: number;
  readonly scheduledDate: number;
  readonly homeClub: string;
  readonly awayClub: string;
}

export interface FixturePlayer {
  readonly id: number;
  readonly name: string;
  readonly side: 'home' | 'away';
}

export interface ManualResultPlayerLine {
  readonly playerId: number;
  readonly appearances: 0 | 1;
  readonly goals: number;
  readonly assists: number;
  readonly yellow: number;
  readonly red: number;
  readonly cleanSheet: 0 | 1;
  readonly rating: number | null;
}

export interface ManualResultDraft {
  readonly fixtureId: number;
  readonly homeGoals: number;
  readonly awayGoals: number;
  readonly homePens?: number | null;
  readonly awayPens?: number | null;
  readonly playerLines: readonly ManualResultPlayerLine[];
}

export interface ManualResultCommit {
  readonly matchResultId: number;
  readonly simEventId: number;
  readonly checkpointId: string | null;
  readonly checkpointState: 'created' | 'failed';
  readonly warning: string | null;
}

export interface PostMatchCheckpointRetry {
  readonly matchResultId: number;
  readonly checkpointId: string;
}

export interface PostMatchCheckpointIssue {
  readonly matchResultId: number;
  readonly fixtureId: number;
  readonly state: 'pending' | 'failed';
  readonly lastError: string | null;
}

export interface MatchPrepState {
  readonly checkpointVerified: boolean;
  readonly snapshotState: 'missing' | 'capturing' | 'ready' | 'stale' | 'wrong_save' | 'corrupt';
  readonly decision:
    | { readonly allowed: true; readonly mode: 'snapshot_diff' | 'manual_result'; readonly reason: string }
    | {
      readonly allowed: false;
      readonly reason: string;
      readonly action: string;
      readonly deepLink: string;
    };
}

export interface CheckpointSummary {
  readonly id: string;
  readonly label: string;
  readonly createdAt: number;
  readonly verified: boolean;
}

export type RestoreCheckpointResult =
  | {
    readonly restored: true;
    readonly checkpointId: string;
    readonly safetyCopyPath: string;
  }
  | {
    readonly restored: false;
    readonly cancelled: true;
  };

export interface TenureDesktopApi {
  readonly versions: () => Promise<VersionSurface>;
  readonly syncStatus: () => Promise<SyncStatus>;
  readonly doctorConditions: () => Promise<readonly DoctorConditionView[]>;
  readonly squad: () => Promise<SquadView>;
  readonly compatibilityManifest: () => Promise<CompatibilityManifestSummary>;
  readonly installCompatibilityManifest: () => Promise<CompatibilityManifestInstallResult>;
  readonly environment: () => Promise<EnvironmentSummary>;
  readonly browseForGame: () => Promise<EnvironmentSummary>;
  readonly browseForLiveEditor: () => Promise<EnvironmentSummary>;
  readonly previewBridgeInstall: () => Promise<BridgeInstallPreview>;
  readonly applyBridgeInstall: (allowUserModified: boolean) => Promise<BridgeInstallSummary>;
  readonly pendingFixtures: () => Promise<readonly PendingFixture[]>;
  readonly fixturePlayers: (fixtureId: number) => Promise<readonly FixturePlayer[]>;
  readonly commitManualResult: (draft: ManualResultDraft) => Promise<ManualResultCommit>;
  readonly postMatchCheckpointIssues: () => Promise<readonly PostMatchCheckpointIssue[]>;
  readonly retryPostMatchCheckpoint: (
    matchResultId: number,
  ) => Promise<PostMatchCheckpointRetry>;
  readonly matchPrepState: (manualResultModeConfirmed: boolean) => Promise<MatchPrepState>;
  readonly createPreMatchCheckpoint: (
    manualResultModeConfirmed: boolean,
  ) => Promise<MatchPrepState>;
  readonly listCheckpoints: () => Promise<readonly CheckpointSummary[]>;
  readonly restoreCheckpoint: (checkpointId: string) => Promise<RestoreCheckpointResult>;
  readonly exportDiagnostics: () => Promise<{ readonly cancelled: boolean; readonly path?: string }>;
}

declare global {
  interface Window {
    readonly tenure: TenureDesktopApi;
  }
}
