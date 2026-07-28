const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');
import type {
  CheckpointSummary,
  SyncStatus,
  TenureDesktopApi,
  VersionSurface,
} from '../shared/ipc.js';

type IpcChannels = typeof import('../shared/ipc.js').IPC_CHANNELS;
const IPC_CHANNELS: IpcChannels = {
  versions: 'system:versions',
  syncStatus: 'sync:status',
  checkpointList: 'checkpoint:list',
  diagnosticExport: 'diagnostic:export',
};

const api: TenureDesktopApi = Object.freeze({
  versions: () => ipcRenderer.invoke(IPC_CHANNELS.versions) as Promise<VersionSurface>,
  syncStatus: () => ipcRenderer.invoke(IPC_CHANNELS.syncStatus) as Promise<SyncStatus>,
  listCheckpoints: () =>
    ipcRenderer.invoke(IPC_CHANNELS.checkpointList) as Promise<readonly CheckpointSummary[]>,
  exportDiagnostics: () =>
    ipcRenderer.invoke(IPC_CHANNELS.diagnosticExport) as Promise<{
      readonly cancelled: boolean;
      readonly path?: string;
    }>,
});

contextBridge.exposeInMainWorld('tenure', api);
