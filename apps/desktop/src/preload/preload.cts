const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');
import type {
  CheckpointSummary,
  BridgeInstallPreview,
  BridgeInstallSummary,
  EnvironmentSummary,
  FixturePlayer,
  ManualResultCommit,
  ManualResultDraft,
  MatchPrepState,
  PendingFixture,
  RestoreCheckpointResult,
  SyncStatus,
  TenureDesktopApi,
  VersionSurface,
} from '../shared/ipc.js';

type IpcChannels = typeof import('../shared/ipc.js').IPC_CHANNELS;
const IPC_CHANNELS: IpcChannels = {
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
};

const api: TenureDesktopApi = Object.freeze({
  versions: () => ipcRenderer.invoke(IPC_CHANNELS.versions) as Promise<VersionSurface>,
  syncStatus: () => ipcRenderer.invoke(IPC_CHANNELS.syncStatus) as Promise<SyncStatus>,
  environment: () =>
    ipcRenderer.invoke(IPC_CHANNELS.environmentGet) as Promise<EnvironmentSummary>,
  browseForGame: () =>
    ipcRenderer.invoke(IPC_CHANNELS.environmentBrowseGame) as Promise<EnvironmentSummary>,
  browseForLiveEditor: () =>
    ipcRenderer.invoke(IPC_CHANNELS.environmentBrowseLiveEditor) as Promise<EnvironmentSummary>,
  previewBridgeInstall: () =>
    ipcRenderer.invoke(IPC_CHANNELS.bridgeInstallPreview) as Promise<BridgeInstallPreview>,
  applyBridgeInstall: (allowUserModified: boolean) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.bridgeInstallApply,
      allowUserModified,
    ) as Promise<BridgeInstallSummary>,
  pendingFixtures: () =>
    ipcRenderer.invoke(IPC_CHANNELS.resultPendingFixtures) as Promise<readonly PendingFixture[]>,
  fixturePlayers: (fixtureId: number) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.resultFixturePlayers,
      fixtureId,
    ) as Promise<readonly FixturePlayer[]>,
  commitManualResult: (draft: ManualResultDraft) =>
    ipcRenderer.invoke(IPC_CHANNELS.resultCommitManual, draft) as Promise<ManualResultCommit>,
  matchPrepState: (manualResultModeConfirmed: boolean) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.matchPrepState,
      manualResultModeConfirmed,
    ) as Promise<MatchPrepState>,
  createPreMatchCheckpoint: (manualResultModeConfirmed: boolean) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.matchPrepCheckpoint,
      manualResultModeConfirmed,
    ) as Promise<MatchPrepState>,
  listCheckpoints: () =>
    ipcRenderer.invoke(IPC_CHANNELS.checkpointList) as Promise<readonly CheckpointSummary[]>,
  restoreCheckpoint: (checkpointId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.checkpointRestore, checkpointId) as Promise<RestoreCheckpointResult>,
  exportDiagnostics: () =>
    ipcRenderer.invoke(IPC_CHANNELS.diagnosticExport) as Promise<{
      readonly cancelled: boolean;
      readonly path?: string;
    }>,
});

contextBridge.exposeInMainWorld('tenure', api);
