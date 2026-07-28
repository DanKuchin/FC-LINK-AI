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
  matchPrepState: 'match-prep:state',
  matchPrepCheckpoint: 'match-prep:checkpoint',
  checkpointList: 'checkpoint:list',
  checkpointRestore: 'checkpoint:restore',
  diagnosticExport: 'diagnostic:export',
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

export interface EnvironmentSummary {
  readonly gameFound: boolean;
  readonly gamePath: string | null;
  readonly gameBuild: string | null;
  readonly liveEditorFound: boolean;
  readonly liveEditorPath: string | null;
  readonly requiredLiveEditor: readonly string[] | null;
  readonly problem: string | null;
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
  readonly checkpointId: string;
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
  readonly environment: () => Promise<EnvironmentSummary>;
  readonly browseForGame: () => Promise<EnvironmentSummary>;
  readonly browseForLiveEditor: () => Promise<EnvironmentSummary>;
  readonly previewBridgeInstall: () => Promise<BridgeInstallPreview>;
  readonly applyBridgeInstall: (allowUserModified: boolean) => Promise<BridgeInstallSummary>;
  readonly pendingFixtures: () => Promise<readonly PendingFixture[]>;
  readonly fixturePlayers: (fixtureId: number) => Promise<readonly FixturePlayer[]>;
  readonly commitManualResult: (draft: ManualResultDraft) => Promise<ManualResultCommit>;
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
