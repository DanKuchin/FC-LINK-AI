const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');
import type {
  CheckpointSummary,
  BridgeInstallPreview,
  BridgeInstallSummary,
  EnvironmentSummary,
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
